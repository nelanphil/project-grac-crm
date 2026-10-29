import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Customer } from "../models/mongo/Customer";
import {
  isActivityActorKind,
  isActivityCategory,
  listCustomerActivity,
  withCustomerNames,
} from "../services/customerActivity.service";
import {
  subscribeAllCustomerActivity,
  subscribeCustomerActivity,
} from "../services/customerActivityLive";
import { listCustomerPaymentInvoices } from "../services/customerPaymentInvoices.service";
import { assertOwnerCanAccessCustomer } from "../utils/ownerTerritory";
import { isCustomerRole } from "../utils/roles";

const HEARTBEAT_MS = 25_000;

async function loadAccessibleCustomer(req: AuthRequest, res: Response) {
  if (!req.user || isCustomerRole(req.user)) {
    res.status(403).json({ message: "Staff only" });
    return null;
  }
  const customerId = String(req.params.id ?? "");
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    res.status(400).json({ message: "Invalid customer id" });
    return null;
  }
  const customer = await Customer.findById(customerId)
    .select("_id ownerUserRef county zip state mergedIntoRef")
    .lean();
  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return null;
  }
  const allowed = await assertOwnerCanAccessCustomer(req.user, customer);
  if (!allowed) {
    res.status(403).json({ message: "Customer is outside your territory" });
    return null;
  }
  return customer;
}

export async function getCustomerActivity(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await loadAccessibleCustomer(req, res);
    if (!customer) return;

    const categories = String(req.query.categories ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(isActivityCategory);
    const actorKindRaw = String(req.query.actorKind ?? "").trim();
    const limit = Number(req.query.limit);
    const result = await listCustomerActivity(String(customer._id), {
      before: typeof req.query.before === "string" ? req.query.before : undefined,
      after: typeof req.query.after === "string" ? req.query.after : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      categories,
      actorKind: isActivityActorKind(actorKindRaw) ? actorKindRaw : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error("GET /customers/:id/activity error:", err);
    res.status(500).json({ message: "Failed to load customer history" });
  }
}

export async function getCustomerPaymentInvoices(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await loadAccessibleCustomer(req, res);
    if (!customer) return;
    const invoices = await listCustomerPaymentInvoices(String(customer._id));
    res.json({ invoices });
  } catch (err) {
    console.error("GET /customers/:id/payment-invoices error:", err);
    res.status(500).json({ message: "Failed to load payment activity" });
  }
}

export async function streamCustomerActivity(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const customer = await loadAccessibleCustomer(req, res);
  if (!customer) return;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  const writeFrame = (chunk: string) => {
    if (closed) return;
    try {
      res.write(chunk);
    } catch {
      close();
    }
  };
  const unsubscribe = subscribeCustomerActivity(String(customer._id), (item) => {
    writeFrame(`event: activity\ndata: ${JSON.stringify(item)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    writeFrame(": ping\n\n");
  }, HEARTBEAT_MS);
  writeFrame(": connected\n\n");
  req.on("close", close);
}

function activityQuery(req: AuthRequest) {
  const categories = String(req.query.categories ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isActivityCategory);
  const actorKindRaw = String(req.query.actorKind ?? "").trim();
  const limit = Number(req.query.limit);
  return {
    before: typeof req.query.before === "string" ? req.query.before : undefined,
    after: typeof req.query.after === "string" ? req.query.after : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    categories,
    actorKind: isActivityActorKind(actorKindRaw) ? actorKindRaw : undefined,
  };
}

export async function listAllCustomerActivity(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await listCustomerActivity(null, {
      ...activityQuery(req),
      until: new Date(),
    });
    res.json(result);
  } catch (err) {
    console.error("GET /customer-activity error:", err);
    res.status(500).json({ message: "Failed to load customer history" });
  }
}

export async function streamAllCustomerActivity(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  const writeFrame = (chunk: string) => {
    if (closed) return;
    try {
      res.write(chunk);
    } catch {
      close();
    }
  };
  const unsubscribe = subscribeAllCustomerActivity((item) => {
    if (new Date(item.createdAt).getTime() > Date.now()) return;
    void withCustomerNames([item]).then(([named]) => {
      writeFrame(`event: activity\ndata: ${JSON.stringify(named ?? item)}\n\n`);
    });
  });
  const heartbeat = setInterval(() => {
    writeFrame(": ping\n\n");
  }, HEARTBEAT_MS);
  writeFrame(": connected\n\n");
  req.on("close", close);
}
