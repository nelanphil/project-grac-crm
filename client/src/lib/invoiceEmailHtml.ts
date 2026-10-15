import type {
  CustomerContact,
  InvoiceItem,
  MessagingContactItem,
} from "@/lib/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
}

export function hasValidContactEmail(email: string | null | undefined): boolean {
  return EMAIL_RE.test((email ?? "").trim());
}

export function isInvoicePayable(invoice: Pick<InvoiceItem, "status">): boolean {
  return invoice.status === "open" || invoice.status === "failed";
}

export function invoiceEmailSubject(invoice: Pick<InvoiceItem, "number">): string {
  return `Invoice ${invoice.number}`;
}

function invoiceTotalCents(invoice: InvoiceItem): number {
  const hasDiscount = Boolean(invoice.discountCents && invoice.discountCents > 0);
  const subtotalCents = invoice.originalAmountCents ?? invoice.amountCents;
  return hasDiscount
    ? Math.max(subtotalCents - (invoice.discountCents ?? 0), 0)
    : invoice.amountCents;
}

export function invoiceSmsBody(invoice: InvoiceItem): string {
  const dueLabel = invoice.dueDate ? formatDate(invoice.dueDate) : "";
  const dueSentence = dueLabel && dueLabel !== "—" ? ` Due ${dueLabel}.` : "";
  return `Hi {{first_name}}, invoice ${invoice.number} is ready. Total due: ${formatMoney(invoiceTotalCents(invoice))}.${dueSentence}`;
}

export function hasValidContactPhone(phone: string | null | undefined): boolean {
  return (phone ?? "").replace(/\D/g, "").length >= 7;
}

export function pickInvoicePhoneContact(
  contacts: CustomerContact[],
  preferredContactId?: string | null,
): CustomerContact | null {
  const valid = contacts.filter((contact) =>
    hasValidContactPhone(contact.phone),
  );
  if (preferredContactId) {
    const preferred = valid.find((contact) => contact._id === preferredContactId);
    if (preferred) return preferred;
  }
  return valid.find((contact) => contact.isPrimary) ?? valid[0] ?? null;
}

export function invoiceEmailBodyHtml(invoice: InvoiceItem): string {
  return [
    "<p>Hi {{first_name}},</p>",
    `<p>Please find invoice <strong>${escapeHtml(invoice.number)}</strong> below.</p>`,
    "<p>{{invoice}}</p>",
  ].join("");
}

export function pickInvoiceEmailContact(
  contacts: CustomerContact[],
  preferredContactId?: string | null,
): CustomerContact | null {
  const valid = contacts.filter((contact) =>
    hasValidContactEmail(contact.email),
  );
  if (preferredContactId) {
    const preferred = valid.find((contact) => contact._id === preferredContactId);
    if (preferred) return preferred;
  }
  return valid.find((contact) => contact.isPrimary) ?? valid[0] ?? null;
}

export function messagingContactFromInvoice(
  contact: CustomerContact,
  invoice: InvoiceItem,
): MessagingContactItem {
  const customer = invoice.customer;
  return {
    _id: contact._id,
    first: contact.first,
    last: contact.last,
    phone: contact.phone,
    email: contact.email,
    label: contact.label,
    isPrimary: contact.isPrimary,
    customerRef: contact.customerRef,
    customer: {
      _id: contact.customerRef,
      accountName: customer?.name,
      first: "",
      last: "",
      address: customer?.address ?? "",
      city: customer?.city ?? "",
      state: customer?.state ?? "",
      zip: customer?.zip ?? "",
      phone: customer?.phone ?? "",
    },
    renewalDueDate: null,
    contractType: null,
    hasPayableInvoice: isInvoicePayable(invoice),
  };
}
