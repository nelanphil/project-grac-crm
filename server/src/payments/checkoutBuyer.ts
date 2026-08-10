import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { toE164 } from "../utils/messagingContext";
import { CheckoutBuyer } from "./types";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Resolve buyer contact fields for checkout prefill from the invoice customer.
 * Prefers the primary CustomerContact, then falls back to the Customer record.
 * Invalid/empty values are omitted so checkout still succeeds without prefill.
 */
export async function resolveCheckoutBuyer(
  customerRef?: Types.ObjectId | null,
): Promise<CheckoutBuyer | undefined> {
  if (!customerRef) return undefined;

  const [cust, primaryContact] = await Promise.all([
    Customer.findById(customerRef)
      .select("email phone first last")
      .lean(),
    CustomerContact.findOne({
      customerRef,
      isPrimary: true,
    })
      .select("email phone first last")
      .lean(),
  ]);

  if (!cust && !primaryContact) return undefined;

  const emailRaw = (
    primaryContact?.email ||
    cust?.email ||
    ""
  ).trim();
  const phoneRaw = (
    primaryContact?.phone ||
    cust?.phone ||
    ""
  ).trim();
  const firstName = (
    primaryContact?.first ||
    cust?.first ||
    ""
  ).trim();
  const lastName = (primaryContact?.last || cust?.last || "").trim();

  const buyer: CheckoutBuyer = {};
  if (emailRaw && looksLikeEmail(emailRaw)) {
    buyer.email = emailRaw;
  }
  const phoneE164 = phoneRaw ? toE164(phoneRaw) : null;
  if (phoneE164) {
    buyer.phoneE164 = phoneE164;
  }
  if (firstName) buyer.firstName = firstName;
  if (lastName) buyer.lastName = lastName;

  return Object.keys(buyer).length > 0 ? buyer : undefined;
}
