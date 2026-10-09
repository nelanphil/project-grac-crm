import { COMPANY } from "@/lib/constants";

export const SMS_CONSENT_BRAND = COMPANY.name;

export const SMS_MESSAGE_TYPES =
  "appointment confirmations and reminders, invoices, payment receipts, and account/service alerts";

export const SMS_CONSENT_DISCLOSURE_TEXT = `I agree to receive automated transactional text messages from ${COMPANY.name} at the mobile number I provide, including ${SMS_MESSAGE_TYPES}. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase.`;

export { formatUsPhoneInput, isValidUsPhone } from "@/lib/formatPhone";

export const SMS_OPT_IN_REQUIRED_MESSAGE =
  "A valid 10-digit mobile number is required to opt in to text messages.";
