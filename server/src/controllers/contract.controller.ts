import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Contract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { Equipment } from "../models/mongo/Equipment";
import {
  ContractTemplate,
  ensureServiceContractTemplate,
} from "../models/mongo/ContractTemplate";
import {
  ContractStanding,
  DEFAULT_DURATION_MONTHS,
  computeInitialRenewalDueDate,
  computeRenewalDueDateAfterRenewal,
  getContractStanding,
  isInGoodStanding,
  parseDateOnly,
} from "../utils/contractDates";
import { inferContractType } from "../utils/contractTypes";

async function enrichWithCustomer(
  contracts: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const customerIds = [
    ...new Set(
      contracts
        .map((c) => c.customerRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  const customers = await Customer.find({ _id: { $in: customerIds } })
    .select("_id first last address city state zip phone")
    .lean();

  const customerById = new Map(
    customers.map((c) => [
      c._id.toString(),
      {
        _id: c._id,
        first: c.first,
        last: c.last,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        phone: c.phone,
      },
    ]),
  );

  return contracts.map((c) => ({
    ...c,
    customer: customerById.get(c.customerRef?.toString() ?? "") ?? null,
  }));
}

async function enrichWithAddress(
  contracts: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const addressIds = [
    ...new Set(
      contracts
        .map((c) => c.addressRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  if (addressIds.length === 0) {
    return contracts.map((c) => ({ ...c, address: null }));
  }

  const addresses = await CustomerAddress.find({ _id: { $in: addressIds } })
    .select("_id label address city state zip isPrimary")
    .lean();

  const byId = new Map(
    addresses.map((a) => [
      a._id.toString(),
      {
        _id: a._id.toString(),
        label: a.label,
        address: a.address,
        city: a.city,
        state: a.state,
        zip: a.zip,
        isPrimary: a.isPrimary,
      },
    ]),
  );

  return contracts.map((c) => ({
    ...c,
    address: byId.get(c.addressRef?.toString() ?? "") ?? null,
  }));
}

async function enrichWithEquipment(
  contracts: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const equipmentIds = [
    ...new Set(
      contracts
        .map((c) => c.equipmentRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  if (equipmentIds.length === 0) {
    return contracts.map((c) => ({ ...c, equipment: null }));
  }

  const equipment = await Equipment.find({ _id: { $in: equipmentIds } })
    .select("_id addressRef generatorModel serial atsSerial")
    .lean();

  const byId = new Map(
    equipment.map((eq) => [
      eq._id.toString(),
      {
        _id: eq._id.toString(),
        addressRef: eq.addressRef.toString(),
        generatorModel: eq.generatorModel,
        serial: eq.serial,
        atsSerial: eq.atsSerial,
      },
    ]),
  );

  return contracts.map((c) => ({
    ...c,
    equipment: byId.get(c.equipmentRef?.toString() ?? "") ?? null,
  }));
}

/**
 * Resolve and validate addressRef + equipmentRef for a customer.
 * Equipment must belong to the customer and to the effective address.
 * Passing only equipmentRef infers addressRef from that equipment.
 */
async function resolveContractLocation(opts: {
  customerId: Types.ObjectId;
  addressRef?: unknown;
  equipmentRef?: unknown;
  existingAddressRef?: Types.ObjectId | null;
  existingEquipmentRef?: Types.ObjectId | null;
}): Promise<{
  addressRef?: Types.ObjectId | null;
  equipmentRef?: Types.ObjectId | null;
  error?: string;
}> {
  const addressProvided = opts.addressRef !== undefined;
  const equipmentProvided = opts.equipmentRef !== undefined;

  if (!addressProvided && !equipmentProvided) {
    return {};
  }

  let addressId: Types.ObjectId | null =
    opts.existingAddressRef ?? null;
  let equipmentId: Types.ObjectId | null =
    opts.existingEquipmentRef ?? null;

  if (addressProvided) {
    if (opts.addressRef === null || opts.addressRef === "") {
      addressId = null;
      equipmentId = null;
    } else {
      if (!Types.ObjectId.isValid(String(opts.addressRef))) {
        return { error: "Invalid addressRef" };
      }
      const site = await CustomerAddress.findOne({
        _id: opts.addressRef,
        customerRef: opts.customerId,
      }).lean();
      if (!site) {
        return { error: "addressRef must belong to the customer" };
      }
      addressId = site._id as Types.ObjectId;
      // Drop existing equipment if it doesn't belong to the new address
      if (equipmentId && !equipmentProvided) {
        const existingEq = await Equipment.findById(equipmentId).lean();
        if (
          !existingEq ||
          !(existingEq.addressRef as Types.ObjectId).equals(addressId)
        ) {
          equipmentId = null;
        }
      }
    }
  }

  if (equipmentProvided) {
    if (opts.equipmentRef === null || opts.equipmentRef === "") {
      equipmentId = null;
    } else {
      if (!Types.ObjectId.isValid(String(opts.equipmentRef))) {
        return { error: "Invalid equipmentRef" };
      }
      const eq = await Equipment.findOne({
        _id: opts.equipmentRef,
        customerRef: opts.customerId,
      }).lean();
      if (!eq) {
        return { error: "equipmentRef must belong to the customer" };
      }
      const eqAddressId = eq.addressRef as Types.ObjectId;
      if (addressProvided && addressId && !eqAddressId.equals(addressId)) {
        return { error: "equipmentRef must belong to the selected address" };
      }
      if (!addressProvided) {
        addressId = eqAddressId;
      } else if (!addressId) {
        return { error: "Cannot set equipmentRef without an addressRef" };
      }
      equipmentId = eq._id as Types.ObjectId;
    }
  }

  const result: {
    addressRef?: Types.ObjectId | null;
    equipmentRef?: Types.ObjectId | null;
  } = {};

  if (addressProvided || (equipmentProvided && opts.equipmentRef)) {
    result.addressRef = addressId;
  }
  if (equipmentProvided || addressProvided) {
    result.equipmentRef = equipmentId;
  }

  return result;
}

async function enrichWithTemplate(
  contracts: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const templateIds = [
    ...new Set(
      contracts
        .map((c) => c.templateId?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  if (templateIds.length === 0) {
    return contracts.map((c) => ({ ...c, template: null }));
  }

  const templates = await ContractTemplate.find({
    _id: { $in: templateIds },
  })
    .select("_id label slug badgeIcon cost deletedAt")
    .lean();

  const templateById = new Map(
    templates.map((t) => [
      t._id.toString(),
      {
        _id: t._id,
        label: t.label,
        slug: t.slug,
        badgeIcon: t.badgeIcon,
        cost: t.cost,
        deletedAt: t.deletedAt ?? null,
      },
    ]),
  );

  return contracts.map((c) => ({
    ...c,
    template: templateById.get(c.templateId?.toString() ?? "") ?? null,
  }));
}

function enrichWithStanding(
  contracts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return contracts.map((c) => {
    const renewalDueDate = c.renewalDueDate
      ? parseDateOnly(c.renewalDueDate as string | Date)
      : null;
    const standing = getContractStanding(renewalDueDate);
    const inGoodStanding = isInGoodStanding(renewalDueDate);

    return {
      ...c,
      standing,
      inGoodStanding,
    };
  });
}

function filterByStanding(
  contracts: Array<Record<string, unknown>>,
  standing: string | undefined,
): Array<Record<string, unknown>> {
  if (!standing || standing === "all") return contracts;

  const allowed = new Set<ContractStanding>(["active", "due_soon", "expired"]);
  if (!allowed.has(standing as ContractStanding)) return contracts;

  return contracts.filter((c) => c.standing === standing);
}

function parseDurationMonths(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_DURATION_MONTHS;
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
}

const ORIGINAL_DATE_EDIT_ROLES = new Set(["admin", "super-admin"]);

function canEditOriginalContractDate(role: string | undefined): boolean {
  return role != null && ORIGINAL_DATE_EDIT_ROLES.has(role);
}

async function resolveTemplateAssignment(opts: {
  templateId?: unknown;
  description: string;
}): Promise<{ templateId: Types.ObjectId | null; contractType: string | null }> {
  if (opts.templateId != null && opts.templateId !== "") {
    const id = String(opts.templateId);
    if (!Types.ObjectId.isValid(id)) {
      throw new Error("INVALID_TEMPLATE_ID");
    }
    const template = await ContractTemplate.findOne({
      _id: id,
      deletedAt: null,
    }).lean();
    if (!template) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }
    return {
      templateId: template._id as Types.ObjectId,
      contractType: template.slug,
    };
  }

  const inferred = inferContractType(opts.description);
  if (inferred === "service") {
    const service = await ensureServiceContractTemplate();
    return {
      templateId: service._id as Types.ObjectId,
      contractType: "service",
    };
  }

  return { templateId: null, contractType: inferred };
}

async function enrichContract(
  contract: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [withCustomer] = await enrichWithCustomer([contract]);
  const [withAddress] = await enrichWithAddress([withCustomer]);
  const [withEquipment] = await enrichWithEquipment([withAddress]);
  const [withTemplate] = await enrichWithTemplate([withEquipment]);
  const [enriched] = enrichWithStanding([withTemplate]);
  return enriched;
}

// GET /contracts?customerId=<legacyId>&addressId=<ObjectId>&standing=active|due_soon|expired
export async function getContracts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const filter: Record<string, unknown> = {};

    if (req.query.customerId) {
      const id = parseInt(req.query.customerId as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: "Invalid customerId" });
        return;
      }
      filter.customerId = id;
    }

    if (req.query.addressId) {
      const addressId = String(req.query.addressId);
      if (!Types.ObjectId.isValid(addressId)) {
        res.status(400).json({ message: "Invalid addressId" });
        return;
      }
      filter.addressRef = addressId;
    }

    if (req.query.equipmentId) {
      const equipmentId = String(req.query.equipmentId);
      if (!Types.ObjectId.isValid(equipmentId)) {
        res.status(400).json({ message: "Invalid equipmentId" });
        return;
      }
      filter.equipmentRef = equipmentId;
    }

    const contracts = await Contract.find(filter)
      .sort({ renewalDueDate: 1, contractDate: -1 })
      .lean();

    const withCustomer = await enrichWithCustomer(contracts);
    const withAddress = await enrichWithAddress(withCustomer);
    const withEquipment = await enrichWithEquipment(withAddress);
    const withTemplate = await enrichWithTemplate(withEquipment);
    const withStanding = enrichWithStanding(withTemplate);
    const standingFilter = req.query.standing as string | undefined;
    const filtered = filterByStanding(withStanding, standingFilter);

    res.json({ contracts: filtered });
  } catch {
    res.status(500).json({ message: "Failed to fetch contracts" });
  }
}

// GET /contracts/:id
export async function getContractById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contract = await Contract.findById(req.params.id).lean();
    if (!contract) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }

    const enriched = await enrichContract(contract);
    res.json({ contract: enriched });
  } catch {
    res.status(500).json({ message: "Failed to fetch contract" });
  }
}

// POST /contracts
export async function createContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const {
      customerId,
      contractDate,
      description,
      durationMonths: rawDuration,
      templateId: rawTemplateId,
      addressRef: rawAddressRef,
      equipmentRef: rawEquipmentRef,
    } = req.body;
    if (!customerId) {
      res.status(400).json({ message: "customerId is required" });
      return;
    }

    const durationMonths = parseDurationMonths(rawDuration);
    if (durationMonths == null) {
      res.status(400).json({ message: "durationMonths must be at least 1" });
      return;
    }

    const customer = await Customer.findOne({ legacyId: customerId }).lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const location = await resolveContractLocation({
      customerId: customer._id as Types.ObjectId,
      addressRef: rawAddressRef ?? null,
      equipmentRef: rawEquipmentRef ?? null,
    });
    if (location.error) {
      res.status(400).json({ message: location.error });
      return;
    }

    const contractDescription = description ?? "";
    let assignment: { templateId: Types.ObjectId | null; contractType: string | null };
    try {
      assignment = await resolveTemplateAssignment({
        templateId: rawTemplateId,
        description: contractDescription,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_TEMPLATE_ID") {
        res.status(400).json({ message: "Invalid templateId" });
        return;
      }
      if (err instanceof Error && err.message === "TEMPLATE_NOT_FOUND") {
        res.status(404).json({ message: "Contract template not found" });
        return;
      }
      throw err;
    }

    const parsedContractDate = parseDateOnly(contractDate);
    const contract = await Contract.create({
      customerId,
      customerRef: customer._id,
      addressRef: location.addressRef ?? null,
      equipmentRef: location.equipmentRef ?? null,
      templateId: assignment.templateId,
      originalContractDate: parsedContractDate,
      contractDate: parsedContractDate,
      durationMonths,
      renewalDueDate: computeInitialRenewalDueDate(parsedContractDate, durationMonths),
      lastRenewalDate: null,
      renewals: [],
      description: contractDescription,
      contractType: assignment.contractType,
      userId: req.user ? parseInt(req.user.id, 10) : undefined,
    });

    const enriched = await enrichContract(
      contract.toObject() as unknown as Record<string, unknown>,
    );
    res.status(201).json({ contract: enriched });
  } catch {
    res.status(500).json({ message: "Failed to create contract" });
  }
}

// PATCH /contracts/:id
export async function updateContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const {
      contractDate,
      description,
      durationMonths: rawDuration,
      originalContractDate,
      templateId: rawTemplateId,
      addressRef: rawAddressRef,
      equipmentRef: rawEquipmentRef,
    } = req.body;

    if (
      originalContractDate !== undefined &&
      !canEditOriginalContractDate(req.user?.role)
    ) {
      res.status(403).json({ message: "Only admins can change originalContractDate" });
      return;
    }

    const existing = await Contract.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }

    const updates: Record<string, unknown> = {};

    if (rawTemplateId !== undefined || description !== undefined) {
      const nextDescription =
        description !== undefined ? description : existing.description;
      try {
        const assignment = await resolveTemplateAssignment({
          templateId: rawTemplateId !== undefined ? rawTemplateId : undefined,
          description: nextDescription,
        });
        if (description !== undefined) {
          updates.description = description;
        }
        // Only overwrite template when explicitly provided, or when description
        // inference yields a type and no template was explicitly cleared.
        if (rawTemplateId !== undefined) {
          updates.templateId = assignment.templateId;
          updates.contractType = assignment.contractType;
        } else if (description !== undefined) {
          updates.contractType = assignment.contractType;
          if (assignment.templateId && !existing.templateId) {
            updates.templateId = assignment.templateId;
          } else if (assignment.contractType === "service" && assignment.templateId) {
            updates.templateId = assignment.templateId;
            updates.contractType = assignment.contractType;
          } else if (!assignment.contractType && !existing.templateId) {
            updates.contractType = null;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message === "INVALID_TEMPLATE_ID") {
          res.status(400).json({ message: "Invalid templateId" });
          return;
        }
        if (err instanceof Error && err.message === "TEMPLATE_NOT_FOUND") {
          res.status(404).json({ message: "Contract template not found" });
          return;
        }
        throw err;
      }
    }

    if (originalContractDate !== undefined) {
      updates.originalContractDate = parseDateOnly(originalContractDate);
    }

    if (rawAddressRef !== undefined || rawEquipmentRef !== undefined) {
      if (!existing.customerRef) {
        res.status(400).json({ message: "Contract has no customer reference" });
        return;
      }
      const location = await resolveContractLocation({
        customerId: existing.customerRef as Types.ObjectId,
        addressRef: rawAddressRef,
        equipmentRef: rawEquipmentRef,
        existingAddressRef: existing.addressRef ?? null,
        existingEquipmentRef: existing.equipmentRef ?? null,
      });
      if (location.error) {
        res.status(400).json({ message: location.error });
        return;
      }
      if (location.addressRef !== undefined) {
        updates.addressRef = location.addressRef;
      }
      if (location.equipmentRef !== undefined) {
        updates.equipmentRef = location.equipmentRef;
      }
    }

    const hasRenewals = existing.renewals.length > 0;

    if (contractDate !== undefined) {
      if (hasRenewals) {
        res.status(400).json({
          message: "contractDate cannot be changed after renewals; record a new renewal instead",
        });
        return;
      }
      updates.contractDate = parseDateOnly(contractDate);
    }

    if (rawDuration !== undefined) {
      const durationMonths = parseDurationMonths(rawDuration);
      if (durationMonths == null) {
        res.status(400).json({ message: "durationMonths must be at least 1" });
        return;
      }
      if (hasRenewals) {
        res.status(400).json({
          message: "durationMonths cannot be changed after renewals; record a new renewal instead",
        });
        return;
      }
      updates.durationMonths = durationMonths;
    }

    if (!hasRenewals && (contractDate !== undefined || rawDuration !== undefined)) {
      const nextContractDate =
        updates.contractDate !== undefined
          ? (updates.contractDate as Date | null)
          : existing.contractDate;
      const nextDuration =
        updates.durationMonths !== undefined
          ? (updates.durationMonths as number)
          : existing.durationMonths;
      updates.renewalDueDate = computeInitialRenewalDueDate(
        nextContractDate,
        nextDuration,
      );
    }

    const contract = await Contract.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();

    if (!contract) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }

    const enriched = await enrichContract(contract);
    res.json({ contract: enriched });
  } catch {
    res.status(500).json({ message: "Failed to update contract" });
  }
}

// POST /contracts/:id/renew
export async function renewContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const { renewedAt, durationMonths: rawDuration, notes, workOrderRef } = req.body;

    if (!renewedAt) {
      res.status(400).json({ message: "renewedAt is required" });
      return;
    }

    const renewedAtDate = parseDateOnly(renewedAt);
    if (!renewedAtDate) {
      res.status(400).json({ message: "Invalid renewedAt date" });
      return;
    }

    const durationMonths = parseDurationMonths(rawDuration);
    if (durationMonths == null) {
      res.status(400).json({ message: "durationMonths must be at least 1" });
      return;
    }

    const existing = await Contract.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }

    if (!existing.renewalDueDate) {
      res.status(400).json({
        message: "Contract must have a renewal due date before recording a renewal",
      });
      return;
    }

    const previousDueDate = parseDateOnly(existing.renewalDueDate);
    if (!previousDueDate) {
      res.status(400).json({ message: "Invalid renewal due date on contract" });
      return;
    }

    const { newDueDate, wasLate } = computeRenewalDueDateAfterRenewal(
      renewedAtDate,
      previousDueDate,
      durationMonths,
    );

    const renewalEvent = {
      renewedAt: renewedAtDate,
      durationMonths,
      previousDueDate,
      newDueDate,
      wasLate,
      workOrderRef: workOrderRef || undefined,
      notes: notes ?? "",
      userId: req.user ? parseInt(req.user.id, 10) : undefined,
      createdAt: new Date(),
    };

    existing.lastRenewalDate = renewedAtDate;
    existing.durationMonths = durationMonths;
    existing.renewalDueDate = newDueDate;
    // Late renewals reset the current term start; on-time renewals keep the anchor.
    if (wasLate) {
      existing.contractDate = renewedAtDate;
    }
    existing.renewals.push(renewalEvent);

    await existing.save();

    const enriched = await enrichContract(
      existing.toObject() as unknown as Record<string, unknown>,
    );
    res.json({ contract: enriched });
  } catch {
    res.status(500).json({ message: "Failed to record renewal" });
  }
}

// DELETE /contracts/:id
export async function deleteContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contract = await Contract.findByIdAndDelete(req.params.id).lean();
    if (!contract) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }
    res.status(204).send();
  } catch {
    res.status(500).json({ message: "Failed to delete contract" });
  }
}
