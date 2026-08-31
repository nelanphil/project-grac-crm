import { COMPANY } from "@/lib/constants";

export const SMS_CONSENT_BRAND = COMPANY.name;

export const SMS_MESSAGE_TYPES =
  "appointment confirmations and reminders, invoices, payment receipts, and account/service alerts";

/** Formats a US number as (XXX)XXX-XXXX while typing. */
export function formatUsPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidUsPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length === 10;
}

export const SMS_OPT_IN_REQUIRED_MESSAGE =
  "A valid 10-digit mobile number is required to opt in to text messages.";
