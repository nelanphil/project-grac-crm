import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import {
  activeContactFilter,
  CustomerContact,
} from "../models/mongo/CustomerContact";
import { Equipment } from "../models/mongo/Equipment";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  resolveCheckoutCustomersForAuthUser,
  resolveCustomerRefsForAuthUser,
  resolvePrimaryCustomerForAuthUser,
} from "../utils/resolveCustomerLogin";
import { listPayableCart } from "../services/checkout.service";
import { enrichScheduleWorkOrders } from "../services/schedule.service";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import {
  portalCreateAddressSchema,
  portalCreateContactSchema,
  portalUpdateAddressSchema,
  portalUpdateContactSchema,
} from "../schemas/customerSite.schema";
import { ensureCustomerLoginForPrimaryEmail } from "../utils/ensureCustomerLogin";
import {
  applyContactPrimaryFlag,
  clearOtherHomeownerLabels,
  clearOtherPrimaryContacts,
  isHomeownerLabel,
  LastContactError,
  softDeleteCustomerContact,
  syncCustomerPrimaryContactFields,
} from "../utils/customerContacts";
import {
  applyAddressPrimaryFlag,
  clearOtherPrimary,
  syncCustomerPrimaryFields,
} from "../utils/customerSites";
import { assignCustomerOwner } from "../utils/ownerTerritory";
import {
  EMAIL_CONFLICT_ADMIN,
  findEmailConflict,
  normalizeAccountEmail,
} from "../utils/provisionCustomerAccount";
import { resolveGeocodedAddress } from "../utils/resolveGeocodedAddress";
import {
  getContractStanding,
  isInGoodStanding,
  parseDateOnly,
} from "../utils/contractDates";

const APPOINTMENT_CAP = 5;
const INVOICE_CAP = 5;

function emptyPortalHome() {
  return {
    contracts: [],
    appointments: { upcoming: [], recent: [] },
    balance: { customerLabel: "", items: [], totalCents: 0 },
    invoices: [],
    customers: [],
  };
}

function trimStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function refsInclude(
  refs: Types.ObjectId[],
  customerRef: Types.ObjectId | undefined,
): boolean {
  if (!customerRef) return false;
  const id = String(customerRef);
  return refs.some((ref) => String(ref) === id);
}

async function resolvePortalAccountCustomer(userId: string) {
  return resolvePrimaryCustomerForAuthUser(userId);
}

function toPortalAddress(doc: {
  _id: Types.ObjectId;
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  isPrimary?: boolean;
}) {
  return {
    _id: String(doc._id),
    label: doc.label ?? "",
    address: doc.address ?? "",
    city: doc.city ?? "",
    state: doc.state ?? "",
    zip: doc.zip ?? "",
    isPrimary: Boolean(doc.isPrimary),
  };
}

function toPortalContact(doc: {
  _id: Types.ObjectId;
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  label?: string;
  isPrimary?: boolean;
}) {
  return {
    _id: String(doc._id),
    first: doc.first ?? "",
    last: doc.last ?? "",
    phone: doc.phone ?? "",
    email: doc.email ?? "",
    label: doc.label ?? "",
    isPrimary: Boolean(doc.isPrimary),
  };
}

async function loadPortalCustomers(customerRefs: Types.ObjectId[]) {
  const [customers, addresses, contacts] = await Promise.all([
    Customer.find({ _id: { $in: customerRefs } })
      .select("_id accountName")
      .lean(),
    CustomerAddress.find({ customerRef: { $in: customerRefs } })
      .select("customerRef label address city state zip isPrimary")
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean(),
    CustomerContact.find({
      customerRef: { $in: customerRefs },
      ...activeContactFilter,
    })
      .select("customerRef first last phone email label isPrimary")
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean(),
  ]);

  const customerById = new Map(
    customers.map((c) => [String(c._id), c]),
  );
  const addressesByCustomer = new Map<string, ReturnType<typeof toPortalAddress>[]>();
  const contactsByCustomer = new Map<string, ReturnType<typeof toPortalContact>[]>();

  for (const address of addresses) {
    const key = String(address.customerRef);
    const list = addressesByCustomer.get(key) ?? [];
    list.push(toPortalAddress(address));
    addressesByCustomer.set(key, list);
  }
  for (const contact of contacts) {
    const key = String(contact.customerRef);
    const list = contactsByCustomer.get(key) ?? [];
    list.push(toPortalContact(contact));
    contactsByCustomer.set(key, list);
  }

  return customerRefs
    .map((ref) => {
      const customer = customerById.get(String(ref));
      if (!customer) return null;
      return {
        _id: String(customer._id),
        accountName: (customer.accountName ?? "").trim(),
        addresses: addressesByCustomer.get(String(customer._id)) ?? [],
        contacts: contactsByCustomer.get(String(customer._id)) ?? [],
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => {
      const score =
        b.addresses.length +
        b.contacts.length -
        (a.addresses.length + a.contacts.length);
      if (score !== 0) return score;
      return a.accountName.localeCompare(b.accountName);
    });
}

function addressLabel(address: {
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
} | null): string {
  if (!address) return "";
  const line = [address.address, address.city, address.state, address.zip]
    .filter(Boolean)
    .join(", ");
  if (address.label && line) return `${address.label} · ${line}`;
  return address.label || line;
}

async function loadPortalContracts(
  customerRefs: Types.ObjectId[],
  legacyIds: number[],
) {
  const or: Record<string, unknown>[] = [
    { customerRef: { $in: customerRefs } },
  ];
  if (legacyIds.length > 0) {
    or.push({ customerId: { $in: legacyIds } });
  }
  const contracts = await Contract.find({ $or: or })
    .sort({ renewalDueDate: 1 })
    .select(
      "templateId contractType renewalDueDate durationMonths addressRef",
    )
    .lean();

  const templateIds = [
    ...new Set(
      contracts
        .map((c) => c.templateId?.toString())
        .filter(Boolean) as string[],
    ),
  ];
  const addressIds = [
    ...new Set(
      contracts
        .map((c) => c.addressRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  const [templates, addresses] = await Promise.all([
    templateIds.length
      ? ContractTemplate.find({ _id: { $in: templateIds } })
          .select("_id label")
          .lean()
      : [],
    addressIds.length
      ? CustomerAddress.find({ _id: { $in: addressIds } })
          .select("_id label address city state zip")
          .lean()
      : [],
  ]);

  const templateById = new Map(
    templates.map((t) => [t._id.toString(), t.label]),
  );
  const addressById = new Map(
    addresses.map((a) => [
      a._id.toString(),
      {
        label: a.label,
        address: a.address,
        city: a.city,
        state: a.state,
        zip: a.zip,
      },
    ]),
  );

  return contracts.map((c) => {
    const renewalDueDate = parseDateOnly(c.renewalDueDate);
    const standing = getContractStanding(renewalDueDate);
    const site = c.addressRef
      ? (addressById.get(c.addressRef.toString()) ?? null)
      : null;
    return {
      _id: String(c._id),
      templateLabel:
        templateById.get(c.templateId?.toString() ?? "") ||
        (c.contractType ?? "").trim() ||
        "Service contract",
      contractType: c.contractType ?? null,
      standing,
      inGoodStanding: isInGoodStanding(renewalDueDate),
      renewalDueDate: c.renewalDueDate,
      durationMonths: c.durationMonths || 12,
      address: site
        ? {
            label: site.label ?? "",
            address: site.address ?? "",
            city: site.city ?? "",
            state: site.state ?? "",
            zip: site.zip ?? "",
          }
        : null,
    };
  });
}

function toAppointment(wo: Record<string, unknown>) {
  const address = wo.address as
    | {
        label?: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
      }
    | null
    | undefined;
  const assignee = wo.assignee as
    | { first_name?: string; last_name?: string }
    | null
    | undefined;
  const assigneeName = [assignee?.first_name, assignee?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    _id: String(wo._id),
    number: String(wo.number ?? "").trim(),
    descPerform: String(wo.descPerform ?? "").trim(),
    scheduledStart: wo.scheduledStart ?? null,
    scheduledEnd: wo.scheduledEnd ?? null,
    date: wo.date ?? null,
    tech: String(wo.tech ?? "").trim() || assigneeName,
    addressLabel:
      addressLabel(address ?? null) || String(wo.customerAddress ?? "").trim(),
    completed: Boolean(wo.completed),
    canceled: Boolean(wo.appointmentCanceledAt),
  };
}

function appointmentTime(wo: Record<string, unknown>): number {
  const start = wo.scheduledStart;
  if (start instanceof Date) return start.getTime();
  const date = wo.date;
  if (date instanceof Date) return date.getTime();
  return 0;
}

async function loadPortalAppointments(
  customerRefs: Types.ObjectId[],
  legacyIds: number[],
) {
  const or: Record<string, unknown>[] = [
    { customerRef: { $in: customerRefs } },
  ];
  if (legacyIds.length > 0) {
    or.push({ customerId: { $in: legacyIds } });
  }

  const rows = await WorkOrder.find({ $or: or })
    .select(
      "number descPerform scheduledStart scheduledEnd date tech assignedUserRef addressRef completed appointmentCanceledAt customerRef customerAddress",
    )
    .lean();
  const enriched = await enrichScheduleWorkOrders(rows);
  const now = Date.now();

  const upcoming = enriched
    .filter((wo) => {
      if (wo.appointmentCanceledAt) return false;
      const start = wo.scheduledStart;
      return start instanceof Date && start.getTime() >= now;
    })
    .sort((a, b) => appointmentTime(a) - appointmentTime(b))
    .slice(0, APPOINTMENT_CAP);

  const upcomingIds = new Set(upcoming.map((wo) => String(wo._id)));
  const recent = enriched
    .filter((wo) => {
      if (upcomingIds.has(String(wo._id))) return false;
      if (wo.completed) return true;
      const start =
        wo.scheduledStart instanceof Date
          ? wo.scheduledStart
          : wo.date instanceof Date
            ? wo.date
            : null;
      return Boolean(start && start.getTime() < now);
    })
    .sort((a, b) => appointmentTime(b) - appointmentTime(a))
    .slice(0, APPOINTMENT_CAP);

  return {
    upcoming: upcoming.map(toAppointment),
    recent: recent.map(toAppointment),
  };
}

export async function getPortalHome(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const refs = await resolveCustomerRefsForAuthUser(req.user.id);
    if (refs.length === 0) {
      res.json(emptyPortalHome());
      return;
    }

    const customerRows = await Customer.find({ _id: { $in: refs } })
      .select("_id legacyId")
      .lean();
    const legacyIds = customerRows
      .map((c) => c.legacyId)
      .filter((id): id is number => typeof id === "number");

    const [contracts, appointments, balance, invoices, customers] =
      await Promise.all([
        loadPortalContracts(refs, legacyIds),
        loadPortalAppointments(refs, legacyIds),
        resolveCheckoutCustomersForAuthUser(req.user.id).then(
          ({ refs: checkoutRefs, preferredCustomerId }) =>
            listPayableCart(
              checkoutRefs.map((id) => String(id)),
              { preferredCustomerId },
            ),
        ),
        Invoice.find({ customerRef: { $in: refs } })
          .sort({ issuedAt: -1 })
          .limit(INVOICE_CAP)
          .select("number status amountCents issuedAt paidAt")
          .lean(),
        loadPortalCustomers(refs),
      ]);

    res.json({
      contracts,
      appointments,
      balance,
      invoices: invoices.map((invoice) => ({
        _id: String(invoice._id),
        number: invoice.number,
        status: invoice.status,
        amountCents: invoice.amountCents || 0,
        issuedAt: invoice.issuedAt,
        paidAt: invoice.paidAt,
      })),
      customers,
    });
  } catch (err) {
    console.error("GET /portal/home error:", err);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
}

export async function updatePortalAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const addressId = String(req.params.addressId ?? "");
    if (!Types.ObjectId.isValid(addressId)) {
      res.status(400).json({ message: "Invalid address id" });
      return;
    }

    const parsed = portalUpdateAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const refs = await resolveCustomerRefsForAuthUser(req.user.id);
    const address = await CustomerAddress.findById(addressId);
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }
    if (!refsInclude(refs, address.customerRef)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const customer = await Customer.findOne({
      _id: address.customerRef,
      deletedAt: null,
      mergedIntoRef: null,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    if (parsed.data.label !== undefined) address.label = parsed.data.label;
    if (parsed.data.address !== undefined) address.address = parsed.data.address;
    if (parsed.data.city !== undefined) address.city = parsed.data.city;
    if (parsed.data.state !== undefined) address.state = parsed.data.state;
    if (parsed.data.zip !== undefined) address.zip = parsed.data.zip;

    await applyAddressPrimaryFlag(
      customer._id,
      address,
      parsed.data.isPrimary,
    );

    const addressFieldsChanged =
      parsed.data.address !== undefined ||
      parsed.data.city !== undefined ||
      parsed.data.state !== undefined ||
      parsed.data.zip !== undefined;
    if (addressFieldsChanged && trimStr(address.address)) {
      const geocode = await resolveGeocodedAddress({
        street: trimStr(address.address),
        city: trimStr(address.city),
        state: trimStr(address.state),
        zip: trimStr(address.zip),
      });
      if (geocode.ok) {
        address.lat = geocode.match.coordinates?.lat ?? null;
        address.lng = geocode.match.coordinates?.lng ?? null;
      }
    }

    await address.save();
    await syncCustomerPrimaryFields(customer._id);
    await assignCustomerOwner(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "address",
      action: "updated",
      entityId: String(address._id),
      customerRef: customer._id,
      summary: `Address updated for ${custName}`,
      metadata: { label: address.label, customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.json({ address: toPortalAddress(address) });
  } catch (err) {
    console.error("PATCH /portal/addresses/:addressId error:", err);
    res.status(500).json({ message: "Failed to update address" });
  }
}

export async function updatePortalContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const contactId = String(req.params.contactId ?? "");
    if (!Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }

    const parsed = portalUpdateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const refs = await resolveCustomerRefsForAuthUser(req.user.id);
    const contact = await CustomerContact.findOne({
      _id: contactId,
      ...activeContactFilter,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }
    if (!refsInclude(refs, contact.customerRef)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const customer = await Customer.findOne({
      _id: contact.customerRef,
      deletedAt: null,
      mergedIntoRef: null,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const previousEmail = customer.email ?? "";
    const wasPrimary = contact.isPrimary;
    if (parsed.data.first !== undefined) contact.first = parsed.data.first;
    if (parsed.data.last !== undefined) contact.last = parsed.data.last;
    if (parsed.data.phone !== undefined) contact.phone = parsed.data.phone;
    if (parsed.data.email !== undefined) {
      contact.email = normalizeAccountEmail(parsed.data.email);
    }
    if (parsed.data.label !== undefined) contact.label = parsed.data.label;

    const willBePrimary =
      parsed.data.isPrimary === true ||
      (parsed.data.isPrimary !== false && contact.isPrimary);
    const nextPrimaryEmail = willBePrimary
      ? normalizeAccountEmail(contact.email ?? "")
      : "";
    if (willBePrimary && nextPrimaryEmail) {
      const emailConflict = await findEmailConflict(nextPrimaryEmail, {
        excludeCustomerId: customer._id,
        allowCustomerUser: true,
      });
      if (emailConflict) {
        res.status(409).json({ message: EMAIL_CONFLICT_ADMIN });
        return;
      }
    }

    await applyContactPrimaryFlag(
      customer._id,
      contact,
      parsed.data.isPrimary,
    );

    if (isHomeownerLabel(contact.label)) {
      await clearOtherHomeownerLabels(
        customer._id,
        contact._id as Types.ObjectId,
      );
    }

    await contact.save();
    const refreshed = await CustomerContact.findById(contact._id);
    await syncCustomerPrimaryContactFields(customer._id);
    if (wasPrimary || willBePrimary) {
      await ensureCustomerLoginForPrimaryEmail(customer._id, { previousEmail });
    }

    const custName = customerDisplayName(customer);
    const contactName =
      `${contact.first} ${contact.last}`.trim() || "Contact";
    logNotificationAsync({
      entityType: "contact",
      action: "updated",
      entityId: String(contact._id),
      customerRef: customer._id,
      summary: `Contact ${contactName} updated for ${custName}`,
      metadata: { customerName: custName, contactName },
      ...actorFromRequest(req.user),
    });

    res.json({
      contact: toPortalContact((refreshed ?? contact).toObject()),
    });
  } catch (err) {
    console.error("PATCH /portal/contacts/:contactId error:", err);
    res.status(500).json({ message: "Failed to update contact" });
  }
}

export async function createPortalAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const parsed = portalCreateAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const { customer } = await resolvePortalAccountCustomer(req.user.id);
    if (!customer) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const existingCount = await CustomerAddress.countDocuments({
      customerRef: customer._id,
    });
    const makePrimary = parsed.data.isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await clearOtherPrimary(customer._id);
    }

    let lat: number | null = null;
    let lng: number | null = null;
    const street = trimStr(parsed.data.address);
    if (street) {
      const geocode = await resolveGeocodedAddress({
        street,
        city: trimStr(parsed.data.city),
        state: trimStr(parsed.data.state),
        zip: trimStr(parsed.data.zip),
      });
      if (geocode.ok) {
        lat = geocode.match.coordinates?.lat ?? null;
        lng = geocode.match.coordinates?.lng ?? null;
      }
    }

    const address = await CustomerAddress.create({
      customerRef: customer._id,
      label: parsed.data.label,
      address: parsed.data.address,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      county: "",
      countyManual: false,
      isPrimary: makePrimary,
      propertyType: "residential",
      legacyCustomerId: null,
      lat,
      lng,
    });

    await syncCustomerPrimaryFields(customer._id);
    await assignCustomerOwner(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "address",
      action: "created",
      entityId: String(address._id),
      customerRef: customer._id,
      summary: `Address created for ${custName}`,
      metadata: { label: address.label, customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      address: toPortalAddress(address),
      customerId: String(customer._id),
    });
  } catch (err) {
    console.error("POST /portal/addresses error:", err);
    res.status(500).json({ message: "Failed to add address" });
  }
}

export async function createPortalContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const parsed = portalCreateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const { customer } = await resolvePortalAccountCustomer(req.user.id);
    if (!customer) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const contactEmail = normalizeAccountEmail(parsed.data.email ?? "");
    const existingCount = await CustomerContact.countDocuments({
      customerRef: customer._id,
      ...activeContactFilter,
    });
    const makePrimary = parsed.data.isPrimary === true || existingCount === 0;
    const previousEmail = customer.email ?? "";

    if (makePrimary && contactEmail) {
      const emailConflict = await findEmailConflict(contactEmail, {
        excludeCustomerId: customer._id,
        allowCustomerUser: true,
      });
      if (emailConflict) {
        res.status(409).json({ message: EMAIL_CONFLICT_ADMIN });
        return;
      }
    }

    if (makePrimary) {
      await clearOtherPrimaryContacts(customer._id);
    }
    if (isHomeownerLabel(parsed.data.label)) {
      await clearOtherHomeownerLabels(customer._id);
    }

    const contact = await CustomerContact.create({
      customerRef: customer._id,
      first: parsed.data.first,
      last: parsed.data.last,
      phone: parsed.data.phone,
      email: contactEmail,
      label: parsed.data.label,
      isPrimary: makePrimary,
      legacyCustomerId: null,
    });

    const refreshed = await CustomerContact.findById(contact._id);
    await syncCustomerPrimaryContactFields(customer._id);
    if (makePrimary) {
      await ensureCustomerLoginForPrimaryEmail(customer._id, { previousEmail });
    }

    const custName = customerDisplayName(customer);
    const contactName = `${contact.first} ${contact.last}`.trim() || "Contact";
    logNotificationAsync({
      entityType: "contact",
      action: "created",
      entityId: String(contact._id),
      customerRef: customer._id,
      summary: `Contact ${contactName} created for ${custName}`,
      metadata: { customerName: custName, contactName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      contact: toPortalContact((refreshed ?? contact).toObject()),
      customerId: String(customer._id),
    });
  } catch (err) {
    console.error("POST /portal/contacts error:", err);
    res.status(500).json({ message: "Failed to add contact" });
  }
}

export async function deletePortalAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const addressId = String(req.params.addressId ?? "");
    if (!Types.ObjectId.isValid(addressId)) {
      res.status(400).json({ message: "Invalid address id" });
      return;
    }

    const refs = await resolveCustomerRefsForAuthUser(req.user.id);
    const address = await CustomerAddress.findById(addressId);
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }
    if (!refsInclude(refs, address.customerRef)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const customer = await Customer.findOne({
      _id: address.customerRef,
      deletedAt: null,
      mergedIntoRef: null,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const woCount = await WorkOrder.countDocuments({ addressRef: address._id });
    const contractCount = await Contract.countDocuments({
      addressRef: address._id,
    });
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
      const next = await CustomerAddress.findOne({
        customerRef: customer._id,
      }).sort({ createdAt: 1 });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    await syncCustomerPrimaryFields(customer._id);
    await assignCustomerOwner(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "address",
      action: "deleted",
      entityId: addressId,
      customerRef: customer._id,
      summary: `Address deleted for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /portal/addresses/:addressId error:", err);
    res.status(500).json({ message: "Failed to delete address" });
  }
}

export async function deletePortalContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const contactId = String(req.params.contactId ?? "");
    if (!Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }

    const refs = await resolveCustomerRefsForAuthUser(req.user.id);
    const contact = await CustomerContact.findOne({
      _id: contactId,
      ...activeContactFilter,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }
    if (!refsInclude(refs, contact.customerRef)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const customer = await Customer.findOne({
      _id: contact.customerRef,
      deletedAt: null,
      mergedIntoRef: null,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const previousEmail = customer.email ?? "";
    let wasPrimary = false;
    try {
      ({ wasPrimary } = await softDeleteCustomerContact(contact));
    } catch (err) {
      if (err instanceof LastContactError) {
        res.status(409).json({ message: err.message });
        return;
      }
      throw err;
    }

    if (wasPrimary) {
      await ensureCustomerLoginForPrimaryEmail(customer._id, { previousEmail });
    }

    const custName = customerDisplayName(customer);
    const contactName =
      `${contact.first} ${contact.last}`.trim() || "Contact";
    logNotificationAsync({
      entityType: "contact",
      action: "deleted",
      entityId: contactId,
      customerRef: customer._id,
      summary: `Contact ${contactName} deleted for ${custName}`,
      metadata: { customerName: custName, contactName },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /portal/contacts/:contactId error:", err);
    res.status(500).json({ message: "Failed to delete contact" });
  }
}
