import { randomBytes } from "crypto";
import { Types } from "mongoose";
import { env } from "../config/env";
import { Customer, ICustomer } from "../models/mongo/Customer";

export function mintCheckoutKey(): string {
  return randomBytes(24).toString("base64url");
}

export function buildCheckoutUrl(
  key: string,
  opts?: { invoiceId?: string; workOrderId?: string },
): string {
  const params = new URLSearchParams();
  params.set("c", key);
  if (opts?.invoiceId) params.set("invoiceId", opts.invoiceId);
  if (opts?.workOrderId) params.set("workOrderId", opts.workOrderId);
  return `${env.clientUrl.replace(/\/$/, "")}/checkout/?${params.toString()}`;
}

export function buildCheckoutCompleteUrl(
  invoiceId: string,
  extra?: { checkoutKey?: string; from?: string },
): string {
  const params = new URLSearchParams();
  params.set("invoiceId", String(invoiceId));
  if (extra?.checkoutKey) params.set("c", extra.checkoutKey);
  if (extra?.from) params.set("from", extra.from);
  return `${env.clientUrl.replace(/\/$/, "")}/checkout/complete?${params.toString()}`;
}

export function sampleCheckoutUrl(): string {
  return buildCheckoutUrl("sample-preview");
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000,
  );
}

export async function getOrCreateCheckoutKey(
  customerId: string,
): Promise<string> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw new Error("Invalid customer");
  }

  const existing = await Customer.findById(customerId).select("checkoutKey");
  if (!existing) {
    throw new Error("Customer not found");
  }
  if (existing.checkoutKey) return existing.checkoutKey;

  for (let attempt = 0; attempt < 5; attempt++) {
    const key = mintCheckoutKey();
    try {
      const updated = await Customer.findOneAndUpdate(
        {
          _id: existing._id,
          $or: [
            { checkoutKey: null },
            { checkoutKey: { $exists: false } },
            { checkoutKey: "" },
          ],
        },
        { $set: { checkoutKey: key } },
        { new: true },
      ).select("checkoutKey");
      if (updated?.checkoutKey) return updated.checkoutKey;

      const raced = await Customer.findById(customerId).select("checkoutKey");
      if (raced?.checkoutKey) return raced.checkoutKey;
    } catch (err) {
      if (isDuplicateKeyError(err)) continue;
      throw err;
    }
  }

  throw new Error("Failed to allocate checkout key");
}

export async function findCustomerByCheckoutKey(
  key: string,
): Promise<ICustomer | null> {
  const trimmed = key.trim();
  if (!trimmed || trimmed === "sample-preview") return null;
  return Customer.findOne({
    checkoutKey: trimmed,
    deletedAt: null,
  });
}
