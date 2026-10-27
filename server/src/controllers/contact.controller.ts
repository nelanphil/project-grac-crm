import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Customer, activeCustomerFilter, notMergedFilter } from "../models/mongo/Customer";
import {
  activeContactFilter,
  contactPhoneDigits,
  CustomerContact,
  ICustomerContact,
} from "../models/mongo/CustomerContact";
import {
  attachContactSchema,
  createStandaloneContactSchema,
  updateStandaloneContactSchema,
} from "../schemas/contact.schema";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import { canonicalPhoneDigits } from "../utils/customerSites";
import {
  clearOtherPrimaryContacts,
  detachCustomerContact,
  LastContactError,
  syncCustomerPrimaryContactFields,
} from "../utils/customerContacts";
import { ensureCustomerLoginForPrimaryEmail } from "../utils/ensureCustomerLogin";
import { toE164 } from "../utils/messagingContext";
import {
  EMAIL_CONFLICT_ADMIN,
  findEmailConflict,
  normalizeAccountEmail,
} from "../utils/provisionCustomerAccount";

type PublicContact = {
  _id: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
  customerRef: string | null;
  customerName: string | null;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPublicContact(
  doc: {
    _id: Types.ObjectId;
    first?: string;
    last?: string;
    phone?: string;
    email?: string;
    label?: string;
    isPrimary?: boolean;
    customerRef?: Types.ObjectId | null;
  },
  customerName: string | null,
): PublicContact {
  return {
    _id: String(doc._id),
    first: doc.first ?? "",
    last: doc.last ?? "",
    phone: doc.phone ?? "",
    email: doc.email ?? "",
    label: doc.label ?? "",
    isPrimary: Boolean(doc.isPrimary),
    customerRef: doc.customerRef ? String(doc.customerRef) : null,
    customerName,
  };
}

async function presentContacts(
  docs: Array<{
    _id: Types.ObjectId;
    first?: string;
    last?: string;
    phone?: string;
    email?: string;
    label?: string;
    isPrimary?: boolean;
    customerRef?: Types.ObjectId | null;
  }>,
): Promise<PublicContact[]> {
  const ids = [
    ...new Set(
      docs
        .map((doc) => (doc.customerRef ? String(doc.customerRef) : ""))
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  const customers = ids.length
    ? await Customer.find({ _id: { $in: ids } })
        .select("accountName first last")
        .lean()
    : [];
  const names = new Map(
    customers.map((customer) => [String(customer._id), customerDisplayName(customer)]),
  );
  return docs.map((doc) =>
    formatPublicContact(
      doc,
      doc.customerRef ? (names.get(String(doc.customerRef)) ?? null) : null,
    ),
  );
}

async function phoneMatches(phone: string, excludeId?: string): Promise<ICustomerContact[]> {
  const digits = contactPhoneDigits(phone);
  if (digits.length < 7) return [];
  const filter: Record<string, unknown> = {
    ...activeContactFilter,
    phoneDigits: digits,
  };
  if (excludeId && Types.ObjectId.isValid(excludeId)) {
    filter._id = { $ne: excludeId };
  }
  return CustomerContact.find(filter).limit(8);
}

class ContactRequestError extends Error {
  status: number;
  matches?: PublicContact[];

  constructor(status: number, message: string, matches?: PublicContact[]) {
    super(message);
    this.name = "ContactRequestError";
    this.status = status;
    this.matches = matches;
  }
}

async function loadActiveCustomer(customerId: string) {
  if (!Types.ObjectId.isValid(customerId)) return null;
  return Customer.findOne({
    _id: customerId,
    ...activeCustomerFilter,
    ...notMergedFilter,
  });
}

async function attachToCustomer(
  contact: ICustomerContact,
  customerId: string,
): Promise<void> {
  if (contact.customerRef && String(contact.customerRef) === customerId) return;

  const customer = await loadActiveCustomer(customerId);
  if (!customer) {
    throw new ContactRequestError(404, "Customer not found");
  }

  if (contact.customerRef) {
    try {
      await detachCustomerContact(contact);
    } catch (err) {
      if (err instanceof LastContactError) {
        throw new ContactRequestError(409, err.message);
      }
      throw err;
    }
  }

  const existingCount = await CustomerContact.countDocuments({
    customerRef: customer._id,
    ...activeContactFilter,
  });
  const makePrimary = existingCount === 0;
  const contactEmail = normalizeAccountEmail(contact.email ?? "");
  const previousEmail = customer.email ?? "";
  if (makePrimary && contactEmail) {
    const emailConflict = await findEmailConflict(contactEmail, {
      excludeCustomerId: customer._id,
      allowCustomerUser: true,
      allowStaffUser: true,
    });
    if (emailConflict) {
      throw new ContactRequestError(409, EMAIL_CONFLICT_ADMIN);
    }
  }
  if (makePrimary) {
    await clearOtherPrimaryContacts(customer._id, contact._id);
  }

  contact.customerRef = customer._id;
  contact.isPrimary = makePrimary;
  await contact.save();
  await syncCustomerPrimaryContactFields(customer._id);
  if (makePrimary) {
    await ensureCustomerLoginForPrimaryEmail(customer._id, { previousEmail });
  }
}

export async function searchContacts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const search = String(req.query.search ?? "").trim();
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const filter: Record<string, unknown> = { ...activeContactFilter };

    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      const digits = contactPhoneDigits(search);
      const or: Record<string, unknown>[] = [
        { first: pattern },
        { last: pattern },
        { email: pattern },
        { phone: pattern },
        { label: pattern },
      ];
      if (digits.length >= 3) {
        or.push({ phoneDigits: new RegExp(escapeRegex(digits)) });
      }
      const canonical = canonicalPhoneDigits(search);
      if (canonical) or.push({ phoneDigits: canonical });

      const matchingCustomers = await Customer.find({
        ...activeCustomerFilter,
        ...notMergedFilter,
        $or: [{ accountName: pattern }, { first: pattern }, { last: pattern }],
      })
        .select("_id")
        .limit(40)
        .lean();
      if (matchingCustomers.length > 0) {
        or.push({ customerRef: { $in: matchingCustomers.map((row) => row._id) } });
      }
      filter.$or = or;
    }

    const docs = await CustomerContact.find(filter)
      .sort({ last: 1, first: 1 })
      .limit(limit)
      .lean();
    res.json({ contacts: await presentContacts(docs) });
  } catch (err) {
    console.error("GET /contacts error:", err);
    res.status(500).json({ message: "Failed to search contacts" });
  }
}

export async function createStandaloneContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createStandaloneContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const data = parsed.data;
    if (!toE164(data.phone)) {
      res.status(400).json({ message: "Enter a valid phone number" });
      return;
    }

    const matches = await phoneMatches(data.phone);
    if (matches.length > 0) {
      res.status(409).json({
        message: "A contact with this phone number already exists",
        matches: await presentContacts(matches),
      });
      return;
    }

    const contact = await CustomerContact.create({
      customerRef: null,
      first: data.first,
      last: data.last,
      phone: data.phone,
      email: normalizeAccountEmail(data.email),
      label: "",
      isPrimary: false,
      legacyCustomerId: null,
    });

    if (data.customerId) {
      try {
        await attachToCustomer(contact, data.customerId);
      } catch (err) {
        await CustomerContact.deleteOne({ _id: contact._id });
        throw err;
      }
    }

    const [presented] = await presentContacts([contact]);
    logNotificationAsync({
      entityType: "contact",
      action: "created",
      entityId: String(contact._id),
      customerRef: contact.customerRef,
      summary: `Contact ${[contact.first, contact.last].filter(Boolean).join(" ") || "Contact"} created`,
      metadata: { contactName: `${contact.first} ${contact.last}`.trim() },
      ...actorFromRequest(req.user),
    });
    res.status(201).json({ contact: presented });
  } catch (err) {
    if (err instanceof ContactRequestError) {
      res.status(err.status).json({
        message: err.message,
        ...(err.matches ? { matches: err.matches } : {}),
      });
      return;
    }
    console.error("POST /contacts error:", err);
    res.status(500).json({ message: "Failed to create contact" });
  }
}

export async function updateStandaloneContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contactId = String(req.params.id);
    if (!Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }
    const parsed = updateStandaloneContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const contact = await CustomerContact.findOne({
      _id: contactId,
      ...activeContactFilter,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    const data = parsed.data;
    if (data.phone !== undefined) {
      if (!toE164(data.phone)) {
        res.status(400).json({ message: "Enter a valid phone number" });
        return;
      }
      const matches = await phoneMatches(data.phone, contactId);
      if (matches.length > 0) {
        res.status(409).json({
          message: "A contact with this phone number already exists",
          matches: await presentContacts(matches),
        });
        return;
      }
      contact.phone = data.phone;
    }
    if (data.first !== undefined) contact.first = data.first;
    if (data.last !== undefined) contact.last = data.last;
    if (data.email !== undefined) contact.email = normalizeAccountEmail(data.email);
    if (data.label !== undefined) contact.label = data.label;
    await contact.save();

    if (contact.customerRef && contact.isPrimary) {
      await syncCustomerPrimaryContactFields(contact.customerRef);
    }

    const [presented] = await presentContacts([contact]);
    res.json({ contact: presented });
  } catch (err) {
    console.error("PATCH /contacts/:id error:", err);
    res.status(500).json({ message: "Failed to update contact" });
  }
}

export async function attachStandaloneContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contactId = String(req.params.id);
    if (!Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }
    const parsed = attachContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const contact = await CustomerContact.findOne({
      _id: contactId,
      ...activeContactFilter,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    await attachToCustomer(contact, parsed.data.customerId);
    const [presented] = await presentContacts([contact]);
    const name = `${contact.first} ${contact.last}`.trim() || "Contact";
    logNotificationAsync({
      entityType: "contact",
      action: "updated",
      entityId: String(contact._id),
      customerRef: contact.customerRef,
      summary: `Contact ${name} attached to a customer`,
      metadata: { contactName: name },
      ...actorFromRequest(req.user),
    });
    res.json({ contact: presented });
  } catch (err) {
    if (err instanceof ContactRequestError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("POST /contacts/:id/attach error:", err);
    res.status(500).json({ message: "Failed to attach contact" });
  }
}
