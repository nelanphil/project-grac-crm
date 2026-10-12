import { Types } from "mongoose";
import { Customer, activeCustomerFilter } from "../models/mongo/Customer";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";
import {
  MailboxCustomerLink,
  mailboxCustomerName,
  resolveMailboxCustomer,
} from "../utils/mailboxCustomers";

const notMergedFilter = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

type CustomerRow = {
  _id: Types.ObjectId;
  accountName?: string;
  first?: string;
  last?: string;
  email?: string;
};

function toLink(row: CustomerRow): MailboxCustomerLink {
  return {
    id: String(row._id),
    name: mailboxCustomerName(row),
  };
}

function addLink(
  map: Map<string, MailboxCustomerLink[]>,
  email: string,
  link: MailboxCustomerLink,
): void {
  const key = normalizeAccountEmail(email);
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.some((item) => item.id === link.id)) list.push(link);
  map.set(key, list);
}

export async function matchCustomersByEmail(
  emails: string[],
): Promise<Map<string, MailboxCustomerLink | null>> {
  const normalized = [
    ...new Set(
      emails.map((email) => normalizeAccountEmail(email)).filter(Boolean),
    ),
  ];
  const result = new Map<string, MailboxCustomerLink | null>();
  if (normalized.length === 0) return result;

  const [customers, contacts] = await Promise.all([
    Customer.find({
      ...activeCustomerFilter,
      ...notMergedFilter,
      email: { $in: normalized },
    })
      .collation({ locale: "en", strength: 2 })
      .select("_id accountName first last email")
      .lean(),
    CustomerContact.find({
      ...activeContactFilter,
      email: { $in: normalized },
    })
      .collation({ locale: "en", strength: 2 })
      .select("customerRef email")
      .lean(),
  ]);

  const contactIds = [
    ...new Set(
      contacts
        .map((contact) =>
          contact.customerRef ? String(contact.customerRef) : "",
        )
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  const contactCustomers = contactIds.length
    ? await Customer.find({
        _id: { $in: contactIds },
        ...activeCustomerFilter,
        ...notMergedFilter,
      })
        .select("_id accountName first last email")
        .lean()
    : [];
  const contactCustomerById = new Map(
    contactCustomers.map((row) => [String(row._id), row]),
  );

  const primary = new Map<string, MailboxCustomerLink[]>();
  const fromContacts = new Map<string, MailboxCustomerLink[]>();
  for (const row of customers) addLink(primary, row.email ?? "", toLink(row));
  for (const contact of contacts) {
    const customer = contactCustomerById.get(String(contact.customerRef));
    if (!customer) continue;
    addLink(fromContacts, contact.email ?? "", toLink(customer));
  }

  for (const email of normalized) {
    result.set(
      email,
      resolveMailboxCustomer(primary.get(email) ?? [], fromContacts.get(email) ?? []),
    );
  }
  return result;
}
