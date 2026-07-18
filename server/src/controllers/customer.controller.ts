import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { Contract } from "../models/mongo/Contract";
import { Equipment } from "../models/mongo/Equipment";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  createCustomerAddressSchema,
  createCustomerContactSchema,
  createEquipmentSchema,
  mergeCustomersSchema,
  updateCustomerAddressSchema,
  updateCustomerContactSchema,
  updateEquipmentSchema,
} from "../schemas/customerSite.schema";
import {
  ensureCustomerContactFromFlat,
  syncCustomerPrimaryContactFields,
} from "../utils/customerContacts";
import {
  customerHasSiteData,
  ensureCustomerSiteFromFlat,
  normalizePhoneDigits,
  syncCustomerPrimaryFields,
} from "../utils/customerSites";
import { getContractStanding } from "../utils/contractDates";
import { ContractTemplate } from "../models/mongo/ContractTemplate";

function parseLastSvc(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatAddress(doc: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  isPrimary?: boolean;
  legacyCustomerId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    customerRef: doc.customerRef.toString(),
    label: doc.label ?? "",
    address: doc.address ?? "",
    city: doc.city ?? "",
    state: doc.state ?? "",
    zip: doc.zip ?? "",
    isPrimary: Boolean(doc.isPrimary),
    legacyCustomerId: doc.legacyCustomerId ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function formatEquipment(doc: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  addressRef: mongoose.Types.ObjectId;
  generatorModel?: string;
  serial?: string;
  atsSerial?: string;
  lastSvc?: Date | null;
  exday?: string;
  extime?: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    customerRef: doc.customerRef.toString(),
    addressRef: doc.addressRef.toString(),
    generatorModel: doc.generatorModel ?? "",
    serial: doc.serial ?? "",
    atsSerial: doc.atsSerial ?? "",
    lastSvc: doc.lastSvc ? doc.lastSvc.toISOString() : null,
    exday: doc.exday ?? "",
    extime: doc.extime ?? "",
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function formatContact(doc: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  label?: string;
  isPrimary?: boolean;
  legacyCustomerId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    customerRef: doc.customerRef.toString(),
    first: doc.first ?? "",
    last: doc.last ?? "",
    phone: doc.phone ?? "",
    email: doc.email ?? "",
    label: doc.label ?? "",
    isPrimary: Boolean(doc.isPrimary),
    legacyCustomerId: doc.legacyCustomerId ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function findActiveCustomerOr404(
  customerId: string,
  res: Response
): Promise<{
  _id: mongoose.Types.ObjectId;
  legacyId: number;
  first: string;
  last: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  generatorModel: string;
  serial: string;
  atsSerial: string;
  lastSvc: Date | null;
  exday: string;
  extime: string;
  mergedIntoRef?: mongoose.Types.ObjectId | null;
} | null> {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    res.status(400).json({ message: "Invalid customer id" });
    return null;
  }

  const customer = await Customer.findById(customerId).lean();
  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return null;
  }

  return customer;
}

async function loadSitesForCustomer(customerId: mongoose.Types.ObjectId) {
  const addresses = await CustomerAddress.find({ customerRef: customerId })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();
  const equipment = await Equipment.find({ customerRef: customerId })
    .sort({ createdAt: 1 })
    .lean();

  const equipmentByAddress = new Map<string, ReturnType<typeof formatEquipment>[]>();
  for (const item of equipment) {
    const key = item.addressRef.toString();
    const list = equipmentByAddress.get(key) ?? [];
    list.push(formatEquipment(item));
    equipmentByAddress.set(key, list);
  }

  return addresses.map((addr) => ({
    ...formatAddress(addr),
    equipment: equipmentByAddress.get(addr._id.toString()) ?? [],
  }));
}

async function loadContactsForCustomer(customerId: mongoose.Types.ObjectId) {
  const contacts = await CustomerContact.find({ customerRef: customerId })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();
  return contacts.map(formatContact);
}

async function clearOtherPrimary(
  customerId: mongoose.Types.ObjectId,
  keepAddressId?: mongoose.Types.ObjectId
): Promise<void> {
  const filter: Record<string, unknown> = { customerRef: customerId };
  if (keepAddressId) {
    filter._id = { $ne: keepAddressId };
  }
  await CustomerAddress.updateMany(filter, { $set: { isPrimary: false } });
}

async function clearOtherPrimaryContacts(
  customerId: mongoose.Types.ObjectId,
  keepContactId?: mongoose.Types.ObjectId
): Promise<void> {
  const filter: Record<string, unknown> = { customerRef: customerId };
  if (keepContactId) {
    filter._id = { $ne: keepContactId };
  }
  await CustomerContact.updateMany(filter, { $set: { isPrimary: false } });
}

// GET /customers — exclude merged
export async function listCustomers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const customers = await Customer.find({
      $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
    })
      .lean()
      .sort({ last: 1, first: 1 });

    const contacts = await CustomerContact.find({
      customerRef: { $in: customers.map((c) => c._id) },
    })
      .select("customerRef phone")
      .lean();

    const phonesByCustomer = new Map<string, Set<string>>();
    for (const contact of contacts) {
      const digits = normalizePhoneDigits(contact.phone);
      if (digits.length < 7) continue;
      const key = contact.customerRef.toString();
      const set = phonesByCustomer.get(key) ?? new Set<string>();
      set.add(digits);
      phonesByCustomer.set(key, set);
    }

    // Count how many customers share each phone (any contact or denormalized).
    const phoneToCustomerIds = new Map<string, Set<string>>();
    for (const c of customers) {
      const key = c._id.toString();
      const phones = new Set(phonesByCustomer.get(key) ?? []);
      const denorm = normalizePhoneDigits(c.phone);
      if (denorm.length >= 7) phones.add(denorm);
      for (const digits of phones) {
        const set = phoneToCustomerIds.get(digits) ?? new Set<string>();
        set.add(key);
        phoneToCustomerIds.set(digits, set);
      }
    }

    res.status(200).json({
      customers: customers.map((c) => {
        const key = c._id.toString();
        const phones = new Set(phonesByCustomer.get(key) ?? []);
        const denorm = normalizePhoneDigits(c.phone);
        if (denorm.length >= 7) phones.add(denorm);

        let maxPeers = 0;
        for (const digits of phones) {
          const peers = (phoneToCustomerIds.get(digits)?.size ?? 1) - 1;
          if (peers > maxPeers) maxPeers = peers;
        }

        return {
          ...c,
          duplicateCount: maxPeers,
        };
      }),
    });
  } catch (err) {
    console.error("GET /customers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/duplicates?phone=
export async function getCustomerDuplicates(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const phone = normalizePhoneDigits(String(req.query.phone ?? ""));
    if (phone.length < 7) {
      res.status(400).json({ message: "phone query with at least 7 digits is required" });
      return;
    }

    const excludeId = req.query.excludeId
      ? String(req.query.excludeId)
      : undefined;

    const customers = await Customer.find({
      $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
    })
      .select("_id legacyId first last phone email address city state zip")
      .lean();

    const contacts = await CustomerContact.find({
      customerRef: { $in: customers.map((c) => c._id) },
    })
      .select("customerRef phone")
      .lean();

    const matchingCustomerIds = new Set<string>();
    for (const contact of contacts) {
      if (normalizePhoneDigits(contact.phone) === phone) {
        matchingCustomerIds.add(contact.customerRef.toString());
      }
    }
    for (const c of customers) {
      if (normalizePhoneDigits(c.phone) === phone) {
        matchingCustomerIds.add(c._id.toString());
      }
    }

    const matches = customers.filter((c) => {
      if (excludeId && c._id.toString() === excludeId) return false;
      return matchingCustomerIds.has(c._id.toString());
    });

    res.status(200).json({
      phone,
      customers: matches.map((c) => ({
        _id: c._id.toString(),
        legacyId: c.legacyId,
        first: c.first,
        last: c.last,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
      })),
    });
  } catch (err) {
    console.error("GET /customers/duplicates error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id — enriched with sites
export async function getCustomerById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;

    if (customer.mergedIntoRef) {
      res.status(404).json({
        message: "Customer was merged into another account",
        mergedIntoRef: customer.mergedIntoRef.toString(),
      });
      return;
    }

    const existingSites = await CustomerAddress.countDocuments({
      customerRef: customer._id,
    });
    if (existingSites === 0 && customerHasSiteData(customer)) {
      await ensureCustomerSiteFromFlat(customer);
      const addressId = (
        await CustomerAddress.findOne({ customerRef: customer._id }).select("_id").lean()
      )?._id;
      if (addressId) {
        await WorkOrder.updateMany(
          {
            customerId: customer.legacyId,
            $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
          },
          { $set: { addressRef: addressId, customerRef: customer._id } }
        );
        await Contract.updateMany(
          {
            customerId: customer.legacyId,
            $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
          },
          { $set: { addressRef: addressId, customerRef: customer._id } }
        );
      }
    }

    await ensureCustomerContactFromFlat(customer);

    const [addresses, contacts] = await Promise.all([
      loadSitesForCustomer(customer._id),
      loadContactsForCustomer(customer._id),
    ]);

    res.status(200).json({
      customer: {
        ...customer,
        _id: customer._id.toString(),
        lastSvc: customer.lastSvc ? customer.lastSvc.toISOString() : null,
        mergedIntoRef: null,
        addresses,
        contacts,
      },
    });
  } catch (err) {
    console.error("GET /customers/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/addresses
export async function getCustomerAddresses(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addresses = await loadSitesForCustomer(customer._id);
    res.status(200).json({ addresses });
  } catch (err) {
    console.error("GET /customers/:id/addresses error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/addresses
export async function createCustomerAddress(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = createCustomerAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const existingCount = await CustomerAddress.countDocuments({
      customerRef: customer._id,
    });
    const makePrimary = parsed.data.isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await clearOtherPrimary(customer._id);
    }

    const address = await CustomerAddress.create({
      customerRef: customer._id,
      label: parsed.data.label,
      address: parsed.data.address,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      isPrimary: makePrimary,
      legacyCustomerId: null,
    });

    await syncCustomerPrimaryFields(customer._id);

    res.status(201).json({
      address: {
        ...formatAddress(address.toObject()),
        equipment: [],
      },
    });
  } catch (err) {
    console.error("POST /customers/:id/addresses error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/addresses/:addressId
export async function updateCustomerAddress(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addressId = String(req.params.addressId);
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      res.status(400).json({ message: "Invalid address id" });
      return;
    }

    const parsed = updateCustomerAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const address = await CustomerAddress.findOne({
      _id: addressId,
      customerRef: customer._id,
    });
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }

    if (parsed.data.label !== undefined) address.label = parsed.data.label;
    if (parsed.data.address !== undefined) address.address = parsed.data.address;
    if (parsed.data.city !== undefined) address.city = parsed.data.city;
    if (parsed.data.state !== undefined) address.state = parsed.data.state;
    if (parsed.data.zip !== undefined) address.zip = parsed.data.zip;

    if (parsed.data.isPrimary === true) {
      await clearOtherPrimary(customer._id, address._id as mongoose.Types.ObjectId);
      address.isPrimary = true;
    } else if (parsed.data.isPrimary === false && address.isPrimary) {
      // Keep at least one primary if this is the only address
      const others = await CustomerAddress.countDocuments({
        customerRef: customer._id,
        _id: { $ne: address._id },
      });
      if (others === 0) {
        address.isPrimary = true;
      } else {
        address.isPrimary = false;
        const next = await CustomerAddress.findOne({
          customerRef: customer._id,
          _id: { $ne: address._id },
        }).sort({ createdAt: 1 });
        if (next) {
          next.isPrimary = true;
          await next.save();
        }
      }
    }

    await address.save();
    await syncCustomerPrimaryFields(customer._id);

    const equipment = await Equipment.find({ addressRef: address._id }).lean();
    res.status(200).json({
      address: {
        ...formatAddress(address.toObject()),
        equipment: equipment.map(formatEquipment),
      },
    });
  } catch (err) {
    console.error("PATCH /customers/:id/addresses/:addressId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id/addresses/:addressId
export async function deleteCustomerAddress(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addressId = String(req.params.addressId);
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      res.status(400).json({ message: "Invalid address id" });
      return;
    }

    const address = await CustomerAddress.findOne({
      _id: addressId,
      customerRef: customer._id,
    });
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }

    const woCount = await WorkOrder.countDocuments({ addressRef: address._id });
    const contractCount = await Contract.countDocuments({ addressRef: address._id });
    if (woCount > 0 || contractCount > 0) {
      res.status(409).json({
        message:
          "Cannot delete address with linked work orders or contracts. Reassign them first.",
        workOrderCount: woCount,
        contractCount,
      });
      return;
    }

    await Equipment.deleteMany({ addressRef: address._id });
    const wasPrimary = address.isPrimary;
    await address.deleteOne();

    if (wasPrimary) {
      const next = await CustomerAddress.findOne({ customerRef: customer._id }).sort({
        createdAt: 1,
      });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    await syncCustomerPrimaryFields(customer._id);
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/addresses/:addressId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/equipment
export async function createEquipment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = createEquipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(parsed.data.addressRef)) {
      res.status(400).json({ message: "Invalid addressRef" });
      return;
    }

    const address = await CustomerAddress.findOne({
      _id: parsed.data.addressRef,
      customerRef: customer._id,
    }).lean();
    if (!address) {
      res.status(404).json({ message: "Address not found for this customer" });
      return;
    }

    const equipment = await Equipment.create({
      customerRef: customer._id,
      addressRef: address._id,
      generatorModel: parsed.data.generatorModel,
      serial: parsed.data.serial,
      atsSerial: parsed.data.atsSerial,
      lastSvc: parseLastSvc(parsed.data.lastSvc) ?? null,
      exday: parsed.data.exday,
      extime: parsed.data.extime,
    });

    await syncCustomerPrimaryFields(customer._id);
    res.status(201).json({ equipment: formatEquipment(equipment.toObject()) });
  } catch (err) {
    console.error("POST /customers/:id/equipment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/equipment/:equipmentId
export async function updateEquipment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const equipmentId = String(req.params.equipmentId);
    if (!mongoose.Types.ObjectId.isValid(equipmentId)) {
      res.status(400).json({ message: "Invalid equipment id" });
      return;
    }

    const parsed = updateEquipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const equipment = await Equipment.findOne({
      _id: equipmentId,
      customerRef: customer._id,
    });
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    if (parsed.data.addressRef !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(parsed.data.addressRef)) {
        res.status(400).json({ message: "Invalid addressRef" });
        return;
      }
      const address = await CustomerAddress.findOne({
        _id: parsed.data.addressRef,
        customerRef: customer._id,
      }).lean();
      if (!address) {
        res.status(404).json({ message: "Address not found for this customer" });
        return;
      }
      equipment.addressRef = address._id as mongoose.Types.ObjectId;
    }

    if (parsed.data.generatorModel !== undefined) {
      equipment.generatorModel = parsed.data.generatorModel;
    }
    if (parsed.data.serial !== undefined) equipment.serial = parsed.data.serial;
    if (parsed.data.atsSerial !== undefined) equipment.atsSerial = parsed.data.atsSerial;
    if (parsed.data.lastSvc !== undefined) {
      equipment.lastSvc = parseLastSvc(parsed.data.lastSvc) ?? null;
    }
    if (parsed.data.exday !== undefined) equipment.exday = parsed.data.exday;
    if (parsed.data.extime !== undefined) equipment.extime = parsed.data.extime;

    await equipment.save();
    await syncCustomerPrimaryFields(customer._id);
    res.status(200).json({ equipment: formatEquipment(equipment.toObject()) });
  } catch (err) {
    console.error("PATCH /customers/:id/equipment/:equipmentId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id/equipment/:equipmentId
export async function deleteEquipment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const equipmentId = String(req.params.equipmentId);
    if (!mongoose.Types.ObjectId.isValid(equipmentId)) {
      res.status(400).json({ message: "Invalid equipment id" });
      return;
    }

    const equipment = await Equipment.findOne({
      _id: equipmentId,
      customerRef: customer._id,
    });
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    const woCount = await WorkOrder.countDocuments({ equipmentRef: equipment._id });
    if (woCount > 0) {
      res.status(409).json({
        message: "Cannot delete equipment linked to work orders. Reassign them first.",
        workOrderCount: woCount,
      });
      return;
    }

    await equipment.deleteOne();
    await syncCustomerPrimaryFields(customer._id);
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/equipment/:equipmentId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/contacts
export async function getCustomerContacts(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    await ensureCustomerContactFromFlat(customer);
    const contacts = await loadContactsForCustomer(customer._id);
    res.status(200).json({ contacts });
  } catch (err) {
    console.error("GET /customers/:id/contacts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/contacts
export async function createCustomerContact(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = createCustomerContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const existingCount = await CustomerContact.countDocuments({
      customerRef: customer._id,
    });
    const makePrimary = parsed.data.isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await clearOtherPrimaryContacts(customer._id);
    }

    const contact = await CustomerContact.create({
      customerRef: customer._id,
      first: parsed.data.first,
      last: parsed.data.last,
      phone: parsed.data.phone,
      email: parsed.data.email,
      label: parsed.data.label,
      isPrimary: makePrimary,
      legacyCustomerId: null,
    });

    await syncCustomerPrimaryContactFields(customer._id);

    res.status(201).json({ contact: formatContact(contact.toObject()) });
  } catch (err) {
    console.error("POST /customers/:id/contacts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/contacts/:contactId
export async function updateCustomerContact(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const contactId = String(req.params.contactId);
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }

    const parsed = updateCustomerContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const contact = await CustomerContact.findOne({
      _id: contactId,
      customerRef: customer._id,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    if (parsed.data.first !== undefined) contact.first = parsed.data.first;
    if (parsed.data.last !== undefined) contact.last = parsed.data.last;
    if (parsed.data.phone !== undefined) contact.phone = parsed.data.phone;
    if (parsed.data.email !== undefined) contact.email = parsed.data.email;
    if (parsed.data.label !== undefined) contact.label = parsed.data.label;

    if (parsed.data.isPrimary === true) {
      await clearOtherPrimaryContacts(
        customer._id,
        contact._id as mongoose.Types.ObjectId
      );
      contact.isPrimary = true;
    } else if (parsed.data.isPrimary === false && contact.isPrimary) {
      const others = await CustomerContact.countDocuments({
        customerRef: customer._id,
        _id: { $ne: contact._id },
      });
      if (others === 0) {
        contact.isPrimary = true;
      } else {
        contact.isPrimary = false;
        const next = await CustomerContact.findOne({
          customerRef: customer._id,
          _id: { $ne: contact._id },
        }).sort({ createdAt: 1 });
        if (next) {
          next.isPrimary = true;
          await next.save();
        }
      }
    }

    await contact.save();
    await syncCustomerPrimaryContactFields(customer._id);

    res.status(200).json({ contact: formatContact(contact.toObject()) });
  } catch (err) {
    console.error("PATCH /customers/:id/contacts/:contactId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id/contacts/:contactId
export async function deleteCustomerContact(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(String(req.params.id), res);
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const contactId = String(req.params.contactId);
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }

    const contact = await CustomerContact.findOne({
      _id: contactId,
      customerRef: customer._id,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    const total = await CustomerContact.countDocuments({
      customerRef: customer._id,
    });
    if (total <= 1) {
      res.status(409).json({
        message: "Cannot delete the last contact on a customer.",
      });
      return;
    }

    const wasPrimary = contact.isPrimary;
    await contact.deleteOne();

    if (wasPrimary) {
      const next = await CustomerContact.findOne({
        customerRef: customer._id,
      }).sort({ createdAt: 1 });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    await syncCustomerPrimaryContactFields(customer._id);
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/contacts/:contactId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/merge-preview?sourceCustomerId=
export async function getMergePreview(req: AuthRequest, res: Response): Promise<void> {
  try {
    const survivor = await findActiveCustomerOr404(String(req.params.id), res);
    if (!survivor) return;
    if (survivor.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const sourceCustomerId = String(req.query.sourceCustomerId ?? "");
    const source = await findActiveCustomerOr404(sourceCustomerId, res);
    if (!source) return;

    if (survivor._id.equals(source._id)) {
      res.status(400).json({ message: "Cannot merge a customer into itself" });
      return;
    }
    if (source.mergedIntoRef) {
      res.status(400).json({ message: "Source customer was already merged" });
      return;
    }

    await ensureCustomerSiteFromFlat(source);
    await ensureCustomerSiteFromFlat(survivor);
    await ensureCustomerContactFromFlat(source);
    await ensureCustomerContactFromFlat(survivor);

    const [
      survivorAddresses,
      sourceAddresses,
      survivorEquipment,
      sourceEquipment,
      survivorContacts,
      sourceContacts,
      survivorWos,
      sourceWos,
      survivorContracts,
      sourceContracts,
      survivorNoteCount,
      sourceNoteCount,
    ] = await Promise.all([
      CustomerAddress.find({ customerRef: survivor._id }).sort({ isPrimary: -1, createdAt: 1 }).lean(),
      CustomerAddress.find({ customerRef: source._id }).sort({ isPrimary: -1, createdAt: 1 }).lean(),
      Equipment.find({ customerRef: survivor._id }).lean(),
      Equipment.find({ customerRef: source._id }).lean(),
      CustomerContact.find({ customerRef: survivor._id }).sort({ isPrimary: -1, createdAt: 1 }).lean(),
      CustomerContact.find({ customerRef: source._id }).sort({ isPrimary: -1, createdAt: 1 }).lean(),
      WorkOrder.find({ customerId: survivor.legacyId }).select("_id addressRef").lean(),
      WorkOrder.find({ customerId: source.legacyId }).select("_id addressRef").lean(),
      Contract.find({ customerId: survivor.legacyId })
        .select("_id description contractType templateId renewalDueDate addressRef equipmentRef")
        .lean(),
      Contract.find({ customerId: source.legacyId })
        .select("_id description contractType templateId renewalDueDate addressRef equipmentRef")
        .lean(),
      CustomerNote.countDocuments({ customerRef: survivor._id }),
      CustomerNote.countDocuments({ customerRef: source._id }),
    ]);

    const templateIds = [
      ...new Set(
        [...survivorContracts, ...sourceContracts]
          .map((c) => c.templateId?.toString())
          .filter(Boolean) as string[]
      ),
    ];
    const templates =
      templateIds.length > 0
        ? await ContractTemplate.find({ _id: { $in: templateIds } })
            .select("_id label slug")
            .lean()
        : [];
    const templateById = new Map(
      templates.map((t) => [
        t._id.toString(),
        { label: t.label, slug: t.slug },
      ])
    );

    const equipmentByAddress = new Map<string, ReturnType<typeof formatEquipment>[]>();
    for (const eq of [...survivorEquipment, ...sourceEquipment]) {
      const key = eq.addressRef.toString();
      const list = equipmentByAddress.get(key) ?? [];
      list.push(formatEquipment(eq));
      equipmentByAddress.set(key, list);
    }

    function formatContractSummary(c: {
      _id: mongoose.Types.ObjectId;
      description?: string;
      contractType?: string | null;
      templateId?: mongoose.Types.ObjectId | null;
      renewalDueDate?: Date | null;
      addressRef?: mongoose.Types.ObjectId | null;
      equipmentRef?: mongoose.Types.ObjectId | null;
    }) {
      const template = c.templateId
        ? templateById.get(c.templateId.toString())
        : null;
      const standing = getContractStanding(c.renewalDueDate ?? null);
      const equipment =
        c.equipmentRef != null
          ? [...survivorEquipment, ...sourceEquipment].find(
              (e) => e._id.toString() === c.equipmentRef!.toString()
            )
          : null;
      const equipmentLabel = equipment
        ? [equipment.generatorModel, equipment.serial].filter(Boolean).join(" · ") ||
          "Equipment"
        : null;

      return {
        _id: c._id.toString(),
        description: c.description ?? "",
        contractType: c.contractType ?? null,
        templateLabel: template?.label ?? null,
        templateSlug: template?.slug ?? null,
        renewalDueDate: c.renewalDueDate
          ? c.renewalDueDate.toISOString()
          : null,
        standing,
        equipmentLabel,
      };
    }

    function countWosForAddress(
      addressId: mongoose.Types.ObjectId,
      wos: Array<{ addressRef?: mongoose.Types.ObjectId | null }>,
      allAddressesForCustomer: unknown[],
      nullAddressWos: number
    ): number {
      const tagged = wos.filter(
        (w) => w.addressRef?.toString() === addressId.toString()
      ).length;
      // Merge tags null-address WOs onto the sole address when customer has exactly one
      if (allAddressesForCustomer.length === 1) {
        return tagged + nullAddressWos;
      }
      return tagged;
    }

    function contractsForAddress(
      addressId: mongoose.Types.ObjectId,
      contracts: typeof survivorContracts,
      allAddressesForCustomer: unknown[],
      nullAddressContracts: typeof survivorContracts
    ) {
      const tagged = contracts.filter(
        (c) => c.addressRef?.toString() === addressId.toString()
      );
      if (allAddressesForCustomer.length === 1) {
        return [...tagged, ...nullAddressContracts].map(formatContractSummary);
      }
      return tagged.map(formatContractSummary);
    }

    const survivorNullWos = survivorWos.filter((w) => !w.addressRef).length;
    const sourceNullWos = sourceWos.filter((w) => !w.addressRef).length;
    const survivorNullContracts = survivorContracts.filter((c) => !c.addressRef);
    const sourceNullContracts = sourceContracts.filter((c) => !c.addressRef);

    const allocation = [
      ...survivorAddresses.map((addr) => ({
        origin: "survivor" as const,
        _id: addr._id.toString(),
        label: addr.label ?? "",
        address: addr.address ?? "",
        city: addr.city ?? "",
        state: addr.state ?? "",
        zip: addr.zip ?? "",
        // Survivor keeps primary as-is
        isPrimary: Boolean(addr.isPrimary),
        equipment: equipmentByAddress.get(addr._id.toString()) ?? [],
        workOrderCount: countWosForAddress(
          addr._id as mongoose.Types.ObjectId,
          survivorWos,
          survivorAddresses,
          survivorNullWos
        ),
        contracts: contractsForAddress(
          addr._id as mongoose.Types.ObjectId,
          survivorContracts,
          survivorAddresses,
          survivorNullContracts
        ),
      })),
      ...sourceAddresses.map((addr) => ({
        origin: "source" as const,
        _id: addr._id.toString(),
        label: addr.label ?? "",
        address: addr.address ?? "",
        city: addr.city ?? "",
        state: addr.state ?? "",
        zip: addr.zip ?? "",
        // Source primaries become non-primary on merge
        isPrimary: false,
        equipment: equipmentByAddress.get(addr._id.toString()) ?? [],
        workOrderCount: countWosForAddress(
          addr._id as mongoose.Types.ObjectId,
          sourceWos,
          sourceAddresses,
          sourceNullWos
        ),
        contracts: contractsForAddress(
          addr._id as mongoose.Types.ObjectId,
          sourceContracts,
          sourceAddresses,
          sourceNullContracts
        ),
      })),
    ];

    // Unassigned only when null-address records won't be auto-tagged (multi-address side)
    const unassigned = {
      survivor: {
        workOrderCount:
          survivorAddresses.length === 1 ? 0 : survivorNullWos,
        contracts:
          survivorAddresses.length === 1
            ? []
            : survivorNullContracts.map(formatContractSummary),
      },
      source: {
        workOrderCount: sourceAddresses.length === 1 ? 0 : sourceNullWos,
        contracts:
          sourceAddresses.length === 1
            ? []
            : sourceNullContracts.map(formatContractSummary),
      },
    };

    const contacts = [
      ...survivorContacts.map((c) => ({
        origin: "survivor" as const,
        ...formatContact(c),
        // Survivor primary stays primary by default after merge
        isPrimary: Boolean(c.isPrimary),
      })),
      ...sourceContacts.map((c) => ({
        origin: "source" as const,
        ...formatContact(c),
        // Source primaries become non-primary unless user picks them
        isPrimary: false,
      })),
    ];

    const defaultPrimaryContactId =
      survivorContacts.find((c) => c.isPrimary)?._id.toString() ??
      survivorContacts[0]?._id.toString() ??
      sourceContacts[0]?._id.toString() ??
      null;

    const totals = {
      addresses: survivorAddresses.length + sourceAddresses.length,
      equipment: survivorEquipment.length + sourceEquipment.length,
      workOrders: survivorWos.length + sourceWos.length,
      contracts: survivorContracts.length + sourceContracts.length,
      notes: survivorNoteCount + sourceNoteCount,
      contacts: survivorContacts.length + sourceContacts.length,
    };

    res.status(200).json({
      survivor: {
        _id: survivor._id.toString(),
        legacyId: survivor.legacyId,
        first: survivor.first,
        last: survivor.last,
        phone: survivor.phone,
        email: survivor.email,
      },
      source: {
        _id: source._id.toString(),
        legacyId: source.legacyId,
        first: source.first,
        last: source.last,
        phone: source.phone,
        email: source.email,
      },
      contacts,
      defaultPrimaryContactId,
      allocation,
      unassigned,
      totals,
      contractsFromBothSides:
        survivorContracts.length > 0 && sourceContracts.length > 0,
    });
  } catch (err) {
    console.error("GET /customers/:id/merge-preview error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/merge
export async function mergeCustomers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const survivorId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(survivorId)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }

    const parsed = mergeCustomersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const { sourceCustomerId, primaryContactId } = parsed.data;
    if (!mongoose.Types.ObjectId.isValid(sourceCustomerId)) {
      res.status(400).json({ message: "Invalid sourceCustomerId" });
      return;
    }

    if (survivorId === sourceCustomerId) {
      res.status(400).json({ message: "Cannot merge a customer into itself" });
      return;
    }

    if (
      primaryContactId !== undefined &&
      !mongoose.Types.ObjectId.isValid(primaryContactId)
    ) {
      res.status(400).json({ message: "Invalid primaryContactId" });
      return;
    }

    const survivor = await Customer.findById(survivorId);
    const source = await Customer.findById(sourceCustomerId);

    if (!survivor || !source) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    if (survivor.mergedIntoRef || source.mergedIntoRef) {
      res.status(400).json({ message: "One of the customers was already merged" });
      return;
    }

    await ensureCustomerSiteFromFlat(source);
    await ensureCustomerSiteFromFlat(survivor);
    await ensureCustomerContactFromFlat(source);
    await ensureCustomerContactFromFlat(survivor);

    if (primaryContactId) {
      const chosen = await CustomerContact.findOne({
        _id: primaryContactId,
        customerRef: { $in: [survivor._id, source._id] },
      })
        .select("_id")
        .lean();
      if (!chosen) {
        res.status(400).json({
          message: "primaryContactId must belong to the survivor or source customer",
        });
        return;
      }
    }

    // Tag source WOs/contracts to the source's sole address before remapping
    // customerId, so addressRef survives the merge.
    const sourceAddresses = await CustomerAddress.find({
      customerRef: source._id,
    })
      .select("_id")
      .lean();

    if (sourceAddresses.length === 1) {
      const sourceAddressId = sourceAddresses[0]._id;
      const sourceEquipment = await Equipment.find({
        addressRef: sourceAddressId,
      })
        .select("_id")
        .lean();
      const sourceEquipmentId =
        sourceEquipment.length === 1 ? sourceEquipment[0]._id : null;

      const tagFields: Record<string, unknown> = {
        addressRef: sourceAddressId,
        customerRef: source._id,
      };
      if (sourceEquipmentId) {
        tagFields.equipmentRef = sourceEquipmentId;
      }

      await WorkOrder.updateMany(
        {
          customerId: source.legacyId,
          $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
        },
        { $set: tagFields }
      );
      await Contract.updateMany(
        {
          customerId: source.legacyId,
          $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
        },
        { $set: tagFields }
      );
    }

    // Source addresses become non-primary on survivor (survivor keeps its primary)
    await CustomerAddress.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id, isPrimary: false } }
    );

    await Equipment.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id } }
    );

    await WorkOrder.updateMany(
      { customerId: source.legacyId },
      {
        $set: {
          customerId: survivor.legacyId,
          customerRef: survivor._id,
        },
      }
    );

    await Contract.updateMany(
      { customerId: source.legacyId },
      {
        $set: {
          customerId: survivor.legacyId,
          customerRef: survivor._id,
        },
      }
    );

    await CustomerNote.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id } }
    );

    // Source contacts move onto survivor; primaries cleared until we set one.
    await CustomerContact.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id, isPrimary: false } }
    );

    if (primaryContactId) {
      await clearOtherPrimaryContacts(
        survivor._id as mongoose.Types.ObjectId,
        new mongoose.Types.ObjectId(primaryContactId)
      );
      await CustomerContact.updateOne(
        { _id: primaryContactId, customerRef: survivor._id },
        { $set: { isPrimary: true } }
      );
    }

    source.mergedIntoRef = survivor._id as mongoose.Types.ObjectId;
    source.mergedAt = new Date();
    await source.save();

    await syncCustomerPrimaryFields(survivor._id);
    await syncCustomerPrimaryContactFields(survivor._id);

    const [addresses, contacts, refreshed] = await Promise.all([
      loadSitesForCustomer(survivor._id as mongoose.Types.ObjectId),
      loadContactsForCustomer(survivor._id as mongoose.Types.ObjectId),
      Customer.findById(survivor._id).lean(),
    ]);

    res.status(200).json({
      customer: {
        ...refreshed,
        _id: refreshed!._id.toString(),
        lastSvc: refreshed!.lastSvc ? refreshed!.lastSvc.toISOString() : null,
        mergedIntoRef: null,
        addresses,
        contacts,
      },
      mergedSourceId: source._id.toString(),
    });
  } catch (err) {
    console.error("POST /customers/:id/merge error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
