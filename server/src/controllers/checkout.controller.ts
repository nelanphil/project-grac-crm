import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveCheckoutCustomersForAuthUser } from "../utils/resolveCustomerLogin";
import {
  CheckoutError,
  confirmCustomerCheckout,
  listPayableCart,
  previewCheckoutDiscount,
  startCustomerCheckout,
} from "../services/checkout.service";
import {
  buildCheckoutUrl,
  findCustomerByCheckoutKey,
  getOrCreateCheckoutKey,
} from "../utils/checkoutKey";
import { Customer } from "../models/mongo/Customer";

function sessionBody(req: AuthRequest): {
  invoiceIds?: string[];
  workOrderIds?: string[];
  discountCode?: string;
} {
  const body = req.body ?? {};
  const discountCode =
    typeof body.discountCode === "string" ? body.discountCode.trim() : "";
  return {
    invoiceIds: Array.isArray(body.invoiceIds)
      ? body.invoiceIds.map(String)
      : undefined,
    workOrderIds: Array.isArray(body.workOrderIds)
      ? body.workOrderIds.map(String)
      : undefined,
    discountCode: discountCode || undefined,
  };
}

function sendCheckoutError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof CheckoutError) {
    res.status(err.statusCode).json({ message: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({
    message: err instanceof Error ? err.message : fallback,
  });
}

export async function getCheckoutByKey(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const key = String(req.params.key ?? "").trim();
    const customer = await findCustomerByCheckoutKey(key);
    if (!customer) {
      res.status(404).json({ message: "Checkout link not found" });
      return;
    }
    const cart = await listPayableCart([String(customer._id)]);
    res.json(cart);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to load checkout");
  }
}

export async function startCheckoutByKey(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const key = String(req.params.key ?? "").trim();
    const customer = await findCustomerByCheckoutKey(key);
    if (!customer) {
      res.status(404).json({ message: "Checkout link not found" });
      return;
    }
    const { invoiceIds, workOrderIds, discountCode } = sessionBody(req);
    const result = await startCustomerCheckout({
      customerIds: [String(customer._id)],
      invoiceIds,
      workOrderIds,
      discountCode,
      checkoutKey: key,
    });
    res.json(result);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to start checkout");
  }
}

export async function getMyCheckout(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const { refs, preferredCustomerId } =
      await resolveCheckoutCustomersForAuthUser(req.user.id);
    const cart = await listPayableCart(
      refs.map((id) => String(id)),
      { preferredCustomerId },
    );
    res.json(cart);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to load checkout");
  }
}

export async function confirmCheckout(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const body = req.body ?? {};
    const invoiceId =
      typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
    const transactionId =
      typeof body.transactionId === "string" ? body.transactionId.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const result = await confirmCustomerCheckout({
      invoiceId: invoiceId || undefined,
      transactionId: transactionId || undefined,
      orderId: orderId || undefined,
    });
    res.json(result);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to confirm checkout");
  }
}

export async function startMyCheckoutSession(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const { refs } = await resolveCheckoutCustomersForAuthUser(req.user.id);
    if (refs.length === 0) {
      res.status(403).json({ message: "No customer account" });
      return;
    }
    const { invoiceIds, workOrderIds, discountCode } = sessionBody(req);
    const result = await startCustomerCheckout({
      customerIds: refs.map((id) => String(id)),
      invoiceIds,
      workOrderIds,
      discountCode,
      returnFrom: "dashboard",
    });
    res.json(result);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to start checkout");
  }
}

export async function previewCheckoutByKey(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const key = String(req.params.key ?? "").trim();
    const customer = await findCustomerByCheckoutKey(key);
    if (!customer) {
      res.status(404).json({ message: "Checkout link not found" });
      return;
    }
    const { invoiceIds, workOrderIds, discountCode } = sessionBody(req);
    if (!discountCode) {
      res.status(400).json({ message: "Enter a discount code" });
      return;
    }
    const quote = await previewCheckoutDiscount({
      customerIds: [String(customer._id)],
      invoiceIds,
      workOrderIds,
      discountCode,
    });
    res.json(quote);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to apply discount code");
  }
}

export async function previewMyCheckoutDiscount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const { refs } = await resolveCheckoutCustomersForAuthUser(req.user.id);
    if (refs.length === 0) {
      res.status(403).json({ message: "No customer account" });
      return;
    }
    const { invoiceIds, workOrderIds, discountCode } = sessionBody(req);
    if (!discountCode) {
      res.status(400).json({ message: "Enter a discount code" });
      return;
    }
    const quote = await previewCheckoutDiscount({
      customerIds: refs.map((id) => String(id)),
      invoiceIds,
      workOrderIds,
      discountCode,
    });
    res.json(quote);
  } catch (err) {
    sendCheckoutError(res, err, "Failed to apply discount code");
  }
}

export async function getCustomerCheckoutLink(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customerId = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(customerId)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }
    const customer = await Customer.findOne({
      _id: customerId,
      deletedAt: null,
    }).select("_id");
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    const key = await getOrCreateCheckoutKey(customerId);
    res.json({ checkoutUrl: buildCheckoutUrl(key) });
  } catch (err) {
    sendCheckoutError(res, err, "Failed to create checkout link");
  }
}
