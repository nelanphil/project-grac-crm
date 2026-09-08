import { COMPANY } from "@/lib/constants";

export const SMS_CONSENT_BRAND = COMPANY.name;

export const SMS_MESSAGE_TYPES =
  "appointment confirmations and reminders, invoices, payment receipts, and account/service alerts";

export { formatUsPhoneInput, isValidUsPhone } from "@/lib/formatPhone";

export const SMS_OPT_IN_REQUIRED_MESSAGE =
  "A valid 10-digit mobile number is required to opt in to text messages.";
