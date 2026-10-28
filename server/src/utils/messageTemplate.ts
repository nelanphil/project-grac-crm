export interface MergeFieldDef {
  key: string;
  label: string;
  description: string;
  /** When set, the chip is only offered for these template types. */
  templateTypes?: Array<"sms" | "email">;
}

export const MERGE_FIELDS: MergeFieldDef[] = [
  { key: "first_name", label: "First name", description: "Contact first name" },
  { key: "last_name", label: "Last name", description: "Contact last name" },
  { key: "full_name", label: "Full name", description: "Contact first + last" },
  { key: "phone", label: "Phone", description: "Contact phone number" },
  { key: "email", label: "Email", description: "Contact email" },
  {
    key: "customer_first",
    label: "Customer first",
    description: "Primary customer first name",
  },
  {
    key: "customer_last",
    label: "Customer last",
    description: "Primary customer last name",
  },
  { key: "address", label: "Address", description: "Customer street address" },
  { key: "city", label: "City", description: "Customer city" },
  { key: "state", label: "State", description: "Customer state" },
  { key: "zip", label: "ZIP", description: "Customer ZIP code" },
  {
    key: "renewal_due_date",
    label: "Renewal due date",
    description: "Soonest matching renewal due date",
  },
  {
    key: "contract_type",
    label: "Contract type",
    description: "Contract type for the renewal context",
  },
  {
    key: "payment_link",
    label: "Payment link",
    description:
      "A payment link for this invoice when sent from an invoice, otherwise a snapshot of the latest eligible invoice. The covered total is included in the message.",
  },
  {
    key: "invoice",
    label: "Invoice",
    description:
      "Styled invoice from the default invoice template. Renders when the email is previewed or sent for an invoice.",
    templateTypes: ["email"],
  },
];

export type MessageTemplateContext = Record<string, string>;

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const PAYMENT_LINK_TOKEN_RE = /\{\{\s*payment_link\s*\}\}/;
const INVOICE_TOKEN_RE = /\{\{\s*invoice\s*\}\}/;
/** Tokens resolved after HTML sanitization, not by string replacement. */
const PRESERVED_TOKEN_KEYS = new Set(["invoice"]);

/** True when any part includes {{payment_link}}. */
export function templateUsesPaymentLink(...parts: Array<string | undefined>): boolean {
  return parts.some((part) => Boolean(part && PAYMENT_LINK_TOKEN_RE.test(part)));
}

/** True when any part includes {{invoice}}. */
export function templateUsesInvoice(...parts: Array<string | undefined>): boolean {
  return parts.some((part) => Boolean(part && INVOICE_TOKEN_RE.test(part)));
}

export function stripInvoiceToken(value: string): string {
  return value.replace(/\{\{\s*invoice\s*\}\}/g, "");
}

/**
 * A blank first name turns "Hi {{first_name}}," into "Hi ,". Drop that greeting
 * so one template works whether or not we know the person's name.
 */
export function stripEmptyGreeting(value: string): string {
  const paragraph = value.match(/^<p(\s[^>]*)?>\s*Hi\s*,\s*<\/p>\s*/i);
  if (paragraph) return value.slice(paragraph[0].length);
  const inlineHtml = value.match(/^<p(\s[^>]*)?>\s*Hi\s*,\s*/i);
  if (inlineHtml) {
    return `<p${inlineHtml[1] ?? ""}>${value.slice(inlineHtml[0].length)}`;
  }
  return value.replace(/^Hi\s*,\s*/i, "");
}

/** Replace {{key}} tokens. Unknown keys become empty strings. {{invoice}} is left in place. */
export function renderMessageTemplate(
  body: string,
  context: MessageTemplateContext,
): string {
  const rendered = body.replace(TOKEN_RE, (match, key: string) => {
    if (PRESERVED_TOKEN_KEYS.has(key)) return match;
    const value = context[key];
    return value == null ? "" : value;
  });
  return stripEmptyGreeting(rendered);
}

export function formatDateForTemplate(date: Date | null | undefined): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

export const SAMPLE_TEMPLATE_CONTEXT: MessageTemplateContext = {
  first_name: "Jordan",
  last_name: "Lee",
  full_name: "Jordan Lee",
  phone: "(555) 123-4567",
  email: "jordan.lee@example.com",
  customer_first: "Jordan",
  customer_last: "Lee",
  address: "123 Oak Street",
  city: "Tampa",
  state: "FL",
  zip: "33601",
  renewal_due_date: "08/15/2026",
  contract_type: "Service Contract",
  payment_link: "",
};
