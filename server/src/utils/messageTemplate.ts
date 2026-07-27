export interface MergeFieldDef {
  key: string;
  label: string;
  description: string;
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
];

export type MessageTemplateContext = Record<string, string>;

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Replace {{key}} tokens. Unknown keys become empty strings. */
export function renderMessageTemplate(
  body: string,
  context: MessageTemplateContext,
): string {
  return body.replace(TOKEN_RE, (_match, key: string) => {
    const value = context[key];
    return value == null ? "" : value;
  });
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
};
