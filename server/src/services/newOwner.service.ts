import { Types } from "mongoose";
import { Customer, activeCustomerFilter, notMergedFilter } from "../models/mongo/Customer";
import {
  activeContactFilter,
  CustomerContact,
  ICustomerContact,
} from "../models/mongo/CustomerContact";
import { recordCustomerActivity } from "./customerActivity.service";
import {
  detachCustomerContact,
  LastContactError,
  syncCustomerPrimaryContactFields,
} from "../utils/customerContacts";
import { ensureCustomerLoginForPrimaryEmail } from "../utils/ensureCustomerLogin";
import {
  EMAIL_CONFLICT_ADMIN,
  findEmailConflict,
  normalizeAccountEmail,
} from "../utils/provisionCustomerAccount";
import {
  accountNameFromPerson,
  isVacantAccountName,
  VACANT_ACCOUNT_NAME,
} from "../utils/vacantCustomer";

/** Fields written when New Owner takes a person off the property. The contact is kept. */
export const NEW_OWNER_DETACH_UPDATE = {
  customerRef: null,
  isPrimary: false,
} as const;

export class NewOwnerError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NewOwnerError";
    this.status = status;
  }
}

export type NewOwnerContactSnapshot = {
  id: string;
  customerId: string | null;
  first: string;
  last: string;
  phone: string;
  email: string;
};

export type NewOwnerPlan =
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      detachIds: string[];
      keeperId: string | null;
      create: { first: string; last: string; phone: string; email: string } | null;
      accountName: string;
      identity: { first: string; last: string; phone: string; email: string };
      summary: string;
      ensureLogin: boolean;
    };

function personLabel(first: string, last: string): string {
  return `${first} ${last}`.trim() || "Contact";
}

function removedSentence(names: string[]): string {
  if (names.length === 0) return "";
  return ` Removed ${names.join(", ")}.`;
}

/**
 * Decide who leaves, who becomes primary, and what the customer is named.
 * Does not write. The last-contact rule for a different property is enforced
 * here; this customer is allowed to end with zero contacts.
 */
export function planNewOwner(input: {
  customerId: string;
  contactsOnCustomer: NewOwnerContactSnapshot[];
  selected?: NewOwnerContactSnapshot | null;
  otherCustomerActiveCount?: number;
  create?: { first: string; last: string; phone: string; email: string } | null;
}): NewOwnerPlan {
  const selected = input.selected ?? null;
  const create = input.create ?? null;
  if (selected && create) {
    return {
      ok: false,
      status: 400,
      message: "Choose an existing contact or enter a new one.",
    };
  }

  if (
    selected?.customerId &&
    selected.customerId !== input.customerId &&
    (input.otherCustomerActiveCount ?? 0) <= 1
  ) {
    return {
      ok: false,
      status: 409,
      message: "A customer must keep at least one contact.",
    };
  }

  const keeperId = selected?.id ?? null;
  const detachIds = input.contactsOnCustomer
    .filter((contact) => contact.id !== keeperId)
    .map((contact) => contact.id);
  const removedNames = input.contactsOnCustomer
    .filter((contact) => contact.id !== keeperId)
    .map((contact) => personLabel(contact.first, contact.last));

  if (!selected && !create) {
    return {
      ok: true,
      detachIds,
      keeperId: null,
      create: null,
      accountName: VACANT_ACCOUNT_NAME,
      identity: { first: "", last: "", phone: "", email: "" },
      summary: `New owner: property is Vacant.${removedSentence(removedNames)}`,
      ensureLogin: false,
    };
  }

  const person = selected ?? create;
  if (!person) {
    return { ok: false, status: 400, message: "Enter a new contact." };
  }
  const first = person.first ?? "";
  const last = person.last ?? "";
  const phone = person.phone ?? "";
  const email = person.email ?? "";
  const accountName = accountNameFromPerson(first, last) || VACANT_ACCOUNT_NAME;
  const named = isVacantAccountName(accountName)
    ? "property is Vacant"
    : accountName;

  return {
    ok: true,
    detachIds,
    keeperId,
    create: selected
      ? null
      : { first, last, phone, email },
    accountName,
    identity: { first, last, phone, email },
    summary: `New owner: ${named}.${removedSentence(removedNames)}`,
    ensureLogin: Boolean(email.trim()),
  };
}

export type AssignNewOwnerResult = {
  accountName: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  detachedContactIds: string[];
};

function snapshotContact(contact: {
  _id: Types.ObjectId;
  customerRef?: Types.ObjectId | null;
  first?: string | null;
  last?: string | null;
  phone?: string | null;
  email?: string | null;
}): NewOwnerContactSnapshot {
  return {
    id: contact._id.toString(),
    customerId: contact.customerRef ? contact.customerRef.toString() : null,
    first: contact.first ?? "",
    last: contact.last ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
  };
}

export async function assignNewOwner(input: {
  customerId: string;
  contactId?: string;
  contact?: { first: string; last: string; phone: string; email: string };
  actorUserId?: string | null;
}): Promise<AssignNewOwnerResult> {
  if (!Types.ObjectId.isValid(input.customerId)) {
    throw new NewOwnerError(404, "Customer not found");
  }

  const customer = await Customer.findOne({
    _id: input.customerId,
    ...activeCustomerFilter,
    ...notMergedFilter,
  }).select("accountName email");
  if (!customer) {
    throw new NewOwnerError(404, "Customer not found");
  }

  const contacts = await CustomerContact.find({
    customerRef: customer._id,
    ...activeContactFilter,
  }).select("customerRef first last phone email");

  let selected: ICustomerContact | null = null;
  let otherCustomerActiveCount: number | undefined;
  if (input.contactId) {
    if (!Types.ObjectId.isValid(input.contactId)) {
      throw new NewOwnerError(400, "Invalid contact id");
    }
    selected = await CustomerContact.findOne({
      _id: input.contactId,
      ...activeContactFilter,
    });
    if (!selected) {
      throw new NewOwnerError(404, "Contact not found");
    }
    if (
      selected.customerRef &&
      selected.customerRef.toString() !== customer._id.toString()
    ) {
      otherCustomerActiveCount = await CustomerContact.countDocuments({
        customerRef: selected.customerRef,
        ...activeContactFilter,
      });
    }
  }

  const create = input.contact
    ? {
        first: input.contact.first,
        last: input.contact.last,
        phone: input.contact.phone,
        email: normalizeAccountEmail(input.contact.email),
      }
    : null;

  const plan = planNewOwner({
    customerId: customer._id.toString(),
    contactsOnCustomer: contacts.map(snapshotContact),
    selected: selected ? snapshotContact(selected) : null,
    otherCustomerActiveCount,
    create,
  });
  if (!plan.ok) {
    throw new NewOwnerError(plan.status, plan.message);
  }

  if (plan.ensureLogin && plan.identity.email) {
    const emailConflict = await findEmailConflict(plan.identity.email, {
      excludeCustomerId: customer._id,
      allowCustomerUser: true,
      allowStaffUser: true,
    });
    if (emailConflict) {
      throw new NewOwnerError(409, EMAIL_CONFLICT_ADMIN);
    }
  }

  if (
    selected?.customerRef &&
    selected.customerRef.toString() !== customer._id.toString()
  ) {
    const sourceId = selected.customerRef;
    const source = await Customer.findById(sourceId).select("email");
    const previousEmail = source?.email ?? "";
    try {
      const { wasPrimary } = await detachCustomerContact(selected);
      if (wasPrimary) {
        await ensureCustomerLoginForPrimaryEmail(sourceId, { previousEmail });
      }
    } catch (err) {
      if (err instanceof LastContactError) {
        throw new NewOwnerError(409, err.message);
      }
      throw err;
    }
  }

  let keeperId = plan.keeperId;
  if (plan.create) {
    const created = await CustomerContact.create({
      customerRef: customer._id,
      first: plan.create.first,
      last: plan.create.last,
      phone: plan.create.phone,
      email: plan.create.email,
      label: "",
      isPrimary: false,
      legacyCustomerId: null,
    });
    keeperId = created._id.toString();
  } else if (selected) {
    selected.customerRef = customer._id;
    selected.isPrimary = false;
    await selected.save();
    keeperId = selected._id.toString();
  }

  if (plan.detachIds.length > 0) {
    await CustomerContact.updateMany(
      {
        _id: { $in: plan.detachIds },
        customerRef: customer._id,
        ...activeContactFilter,
      },
      { $set: NEW_OWNER_DETACH_UPDATE },
    );
  }

  if (keeperId) {
    await CustomerContact.updateOne(
      { _id: keeperId, ...activeContactFilter },
      { $set: { customerRef: customer._id, isPrimary: true } },
    );
  }

  const previousName = customer.accountName ?? "";
  await Customer.updateOne(
    { _id: customer._id },
    { $set: { accountName: plan.accountName } },
  );
  await syncCustomerPrimaryContactFields(customer._id);
  if (plan.ensureLogin) {
    await ensureCustomerLoginForPrimaryEmail(customer._id);
  }

  await recordCustomerActivity({
    customerRef: customer._id,
    category: "account",
    action: "new_owner",
    summary: plan.summary,
    actorKind: "staff",
    actorUserId: input.actorUserId ?? null,
    changes: [
      { field: "accountName", from: previousName, to: plan.accountName },
    ],
    metadata: {
      detachedContactIds: plan.detachIds,
      vacant: isVacantAccountName(plan.accountName),
    },
    source: "crm",
  });

  const refreshed = await Customer.findById(customer._id)
    .select("accountName first last phone email")
    .lean();

  return {
    accountName: refreshed?.accountName ?? plan.accountName,
    first: refreshed?.first ?? plan.identity.first,
    last: refreshed?.last ?? plan.identity.last,
    phone: refreshed?.phone ?? plan.identity.phone,
    email: refreshed?.email ?? plan.identity.email,
    detachedContactIds: plan.detachIds,
  };
}
