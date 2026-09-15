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

export function invoiceEmailBodyHtml(invoice: InvoiceItem): string {
  const lineItems =
    invoice.lineItems.length > 0
      ? invoice.lineItems
          .map(
            (item) =>
              `<li>${escapeHtml(item.description || "Line item")} — ${escapeHtml(formatMoney(item.amountCents))}</li>`,
          )
          .join("")
      : "<li>No line items.</li>";

  const hasDiscount = Boolean(invoice.discountCents && invoice.discountCents > 0);
  const taxCents = invoice.taxCents ?? 0;
  const totalBeforeDiscount = invoice.originalAmountCents ?? invoice.amountCents;
  const subtotalCents = Math.max(totalBeforeDiscount - taxCents, 0);
  const totalCents = Math.max(totalBeforeDiscount - (invoice.discountCents ?? 0), 0);

  const discountLabel = invoice.discountCode
    ? `Discount ${escapeHtml(invoice.discountCode)}`
    : "Discount";

  const taxLabel =
    invoice.taxRatePercent && invoice.taxRatePercent > 0
      ? `Tax (${invoice.taxRatePercent}%)`
      : "Tax";

  const totalsParts = [
    `<p>Subtotal: ${escapeHtml(formatMoney(subtotalCents))}</p>`,
    hasDiscount
      ? `<p>${discountLabel}: −${escapeHtml(formatMoney(invoice.discountCents ?? 0))}</p>`
      : "",
    `<p>${escapeHtml(taxLabel)}: ${escapeHtml(formatMoney(taxCents))}</p>`,
    `<p><strong>Total due: ${escapeHtml(formatMoney(totalCents))}</strong></p>`,
  ].filter(Boolean);
  const totals = totalsParts.join("");

  const noteItems =
    invoice.workOrderNotes && invoice.workOrderNotes.length > 0
      ? invoice.workOrderNotes
          .map(
            (note) =>
              `<li>${escapeHtml(note.content).replace(/\n/g, "<br>")}</li>`,
          )
          .join("")
      : "";

  const notesBlock = noteItems
    ? `<p><strong>Notes</strong></p><ul>${noteItems}</ul>`
    : "";

  return [
    "<p>Hi {{first_name}},</p>",
    `<p>Please find invoice <strong>${escapeHtml(invoice.number)}</strong> below.</p>`,
    `<h2>Invoice ${escapeHtml(invoice.number)}</h2>`,
    `<p>Issued: ${escapeHtml(formatDate(invoice.issuedAt))} · Due: ${escapeHtml(formatDate(invoice.dueDate))} · Status: ${escapeHtml(invoice.status)}</p>`,
    "<p><strong>Line items</strong></p>",
    `<ul>${lineItems}</ul>`,
    notesBlock,
    totals,
  ]
    .filter(Boolean)
    .join("");
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
