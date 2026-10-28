import type { ProviderPaymentDetail } from "./types";

export type PaymentChannel = "in_person" | "online";

export type DescribedPaymentMethod =
  | "tap_to_pay"
  | "card_present"
  | "card_keyed"
  | "card_online"
  | "wallet"
  | "card";

export type DescribedPayment = {
  channel: PaymentChannel | null;
  method: DescribedPaymentMethod;
  label: string;
};

const IN_PERSON_PRODUCTS = new Set(["SQUARE_POS", "RETAIL", "RESTAURANTS", "TERMINAL_API"]);
const ONLINE_PRODUCTS = new Set(["ECOMMERCE_API", "ONLINE_STORE", "INVOICES", "APPOINTMENTS"]);
const PRESENT_ENTRY = new Set(["CONTACTLESS", "EMV", "SWIPED"]);

const PRODUCT_LABEL: Record<string, string> = {
  SQUARE_POS: "Square Point of Sale app",
  RETAIL: "Square for Retail",
  RESTAURANTS: "Square for Restaurants",
  TERMINAL_API: "Square Terminal",
  ECOMMERCE_API: "Payment link",
  ONLINE_STORE: "Square Online checkout",
  INVOICES: "Square Invoices",
  APPOINTMENTS: "Square Appointments",
  VIRTUAL_TERMINAL: "Square Virtual Terminal",
};

const WALLET_LABEL: Record<string, string> = {
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  CASH_APP: "Cash App Pay",
  AFTERPAY: "Afterpay",
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const BRAND_LABEL: Record<string, string> = {
  AMERICAN_EXPRESS: "Amex",
  MASTERCARD: "Mastercard",
  VISA: "Visa",
  DISCOVER: "Discover",
  DISCOVER_DINERS: "Diners Club",
  JCB: "JCB",
  CHINA_UNIONPAY: "UnionPay",
  SQUARE_GIFT_CARD: "Square gift card",
  INTERAC: "Interac",
  EFTPOS: "EFTPOS",
};

function cardText(detail: ProviderPaymentDetail): string | null {
  const brand = detail.cardBrand
    ? (BRAND_LABEL[detail.cardBrand] ?? titleCase(detail.cardBrand))
    : null;
  if (brand && detail.last4) return `${brand} ending ${detail.last4}`;
  if (detail.last4) return `Card ending ${detail.last4}`;
  if (brand && detail.cardBrand !== "OTHER_BRAND") return brand;
  return null;
}

/** Turns Square's payment fields into how the payment was taken and a staff-facing label. */
export function describeSquarePayment(detail: ProviderPaymentDetail): DescribedPayment {
  const product = detail.squareProduct?.toUpperCase() ?? "";
  const entry = detail.entryMethod?.toUpperCase() ?? "";
  const source = detail.sourceType?.toUpperCase() ?? "";
  const wallet = detail.wallet?.toUpperCase() ?? "";

  let channel: PaymentChannel | null = null;
  if (IN_PERSON_PRODUCTS.has(product) || product === "VIRTUAL_TERMINAL") channel = "in_person";
  else if (ONLINE_PRODUCTS.has(product)) channel = "online";
  else if (PRESENT_ENTRY.has(entry)) channel = "in_person";

  let method: DescribedPaymentMethod;
  let how: string;
  if (source === "WALLET" || source === "BUY_NOW_PAY_LATER" || wallet) {
    method = "wallet";
    how = WALLET_LABEL[wallet] ?? (wallet ? titleCase(wallet) : "Digital wallet");
    if (channel === "in_person") how = `${how} (tapped)`;
  } else if (entry === "CONTACTLESS") {
    method = "tap_to_pay";
    how = "Tap to Pay";
  } else if (entry === "EMV" || entry === "SWIPED") {
    method = "card_present";
    how = entry === "EMV" ? "Chip card" : "Swiped card";
  } else if (entry === "KEYED" && channel === "in_person") {
    method = "card_keyed";
    how = "Card typed by staff";
  } else if ((entry === "KEYED" || entry === "ON_FILE") && channel === "online") {
    method = "card_online";
    how = entry === "ON_FILE" ? "Saved card online" : "Card typed online";
  } else if (entry === "ON_FILE") {
    method = "card";
    how = "Card on file";
  } else {
    method = "card";
    how = "Card";
  }

  const parts = [how, cardText(detail), PRODUCT_LABEL[product] ?? null].filter(
    (part): part is string => Boolean(part),
  );
  return { channel, method, label: parts.join(" · ") };
}
