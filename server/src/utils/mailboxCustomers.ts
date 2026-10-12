export type MailboxCustomerLink = {
  id: string;
  name: string;
};

export function mailboxCustomerName(row: {
  accountName?: string;
  first?: string;
  last?: string;
  email?: string;
}): string {
  const account = row.accountName?.trim();
  if (account) return account;
  const person = `${row.first ?? ""} ${row.last ?? ""}`.trim();
  return person || row.email?.trim() || "Customer";
}

export function counterpartyAddresses(
  folder: "inbox" | "sent",
  from: { address: string }[],
  to: { address: string }[],
): string[] {
  const list = folder === "sent" ? to : from;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const email = item.address.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** One customer only. Ambiguous or missing addresses do not link. */
export function resolveMailboxCustomer(
  primary: MailboxCustomerLink[],
  contacts: MailboxCustomerLink[],
): MailboxCustomerLink | null {
  const primaryIds = [...new Set(primary.map((row) => row.id))];
  if (primaryIds.length > 1) return null;
  if (primaryIds.length === 1) {
    return primary.find((row) => row.id === primaryIds[0]) ?? null;
  }
  const contactIds = [...new Set(contacts.map((row) => row.id))];
  if (contactIds.length === 1) {
    return contacts.find((row) => row.id === contactIds[0]) ?? null;
  }
  return null;
}

export function customerForAddresses(
  addresses: string[],
  matches: Map<string, MailboxCustomerLink | null>,
): MailboxCustomerLink | null {
  if (addresses.length === 0) return null;
  const links: MailboxCustomerLink[] = [];
  for (const address of addresses) {
    const link = matches.get(address.trim().toLowerCase()) ?? null;
    if (!link) return null;
    links.push(link);
  }
  const id = links[0]?.id;
  if (!id || links.some((link) => link.id !== id)) return null;
  return links[0];
}
