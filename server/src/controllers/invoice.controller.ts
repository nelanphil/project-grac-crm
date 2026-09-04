import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { Contract } from "../models/mongo/Contract";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { createInvoiceSchema } from "../schemas/invoice.schema";
import {
  dollarsToCents,
  markInvoicePaid,
  nextInvoiceNumber,
} from "../services/invoice.service";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import { resolveCheckoutProviderForInvoice } from "../payments/registry";
import { resolveCheckoutBuyer } from "../payments/checkoutBuyer";
import { env } from "../config/env";
import { buildPayUrl, hashPayToken, mintPayToken } from "../utils/payToken";

function workOrderInvoiceLineItems(wo: {
  parts?: Array<{
    partNumber?: string;
    description?: string;
    quantity?: number;
    amount?: number;
    lineType?: string;
    kind?: string;
  }>;
  totalLabor?: number;
  miscExp?: number;
  shipping?: number;
  total?: number;
  descPerform?: string;
  number?: string;
}): { description: string; amountCents: number }[] {
  const items: { description: string; amountCents: number }[] = [];
  const parts = wo.parts ?? [];
  let hasLaborProductLines = false;
  for (const part of parts) {
    if (part.lineType === "note") continue;
    if (part.kind === "labor") hasLaborProductLines = true;
    const cents = dollarsToCents(part.amount || 0);
    if (cents <= 0) continue;
    const qty = part.quantity && part.quantity !== 1 ? `${part.quantity} × ` : "";
    const label =
      part.description?.trim() ||
      part.partNumber?.trim() ||
      (part.kind === "labor" ? "Labor" : "Part");
    items.push({
      description: `${qty}${label}${part.partNumber && part.description ? ` (${part.partNumber})` : ""}`,
      amountCents: cents,
    });
  }
  const laborCents = dollarsToCents(wo.totalLabor || 0);
  if (!hasLaborProductLines && laborCents > 0) {
    items.push({ description: "Labor", amountCents: laborCents });
  }
  const miscCents = dollarsToCents(wo.miscExp || 0);
  if (miscCents > 0) {
    items.push({ description: "Miscellaneous", amountCents: miscCents });
  }
  const shippingCents = dollarsToCents(wo.shipping || 0);
  if (shippingCents > 0) {
    items.push({ description: "Shipping", amountCents: shippingCents });
  }
  if (items.length > 0) return items;
  const lump = dollarsToCents(wo.total || 0);
  if (lump > 0) {
    return [
      {
        description:
          `Work order${wo.number ? ` ${wo.number}` : ""}${wo.descPerform ? `: ${wo.descPerform}` : ""}`.trim(),
        amountCents: lump,
      },
    ];
  }
  return [];
}

const STAFF_ROLES = new Set([
  "admin",
  "super-admin",
  "owner",
  "manager",
  "tech",
  "dispatcher",
]);

function toPublicInvoice(doc: IInvoice | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as IInvoice).toObject === "function"
      ? (doc as IInvoice).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    number: d.number,
    customerId: d.customerId,
    customerRef: d.customerRef ? String(d.customerRef) : null,
    sourceType: d.sourceType,
    contractRef: d.contractRef ? String(d.contractRef) : null,
    workOrderRef: d.workOrderRef ? String(d.workOrderRef) : null,
    templateRef: d.templateRef ? String(d.templateRef) : null,
    lineItems: d.lineItems ?? [],
    amountCents: d.amountCents,
    currency: d.currency,
    status: d.status,
    dueDate: d.dueDate,
    issuedAt: d.issuedAt,
    paidAt: d.paidAt,
    paymentProvider: d.paymentProvider,
    providerCheckoutId: d.providerCheckoutId,
    providerOrderId: d.providerOrderId,
    providerPaymentId: d.providerPaymentId,
    hasPayLink: Boolean(d.payTokenHash),
    payTokenExpiresAt: d.payTokenExpiresAt,
    metadata: d.metadata ?? {},
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

type InvoiceCustomerSummary = {
  name: string;
  accountNumber: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
};

type InvoiceServiceAddress = {
  label?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

function customerDisplayName(customer: {
  accountName?: string;
  first?: string;
  last?: string;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  return `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
}

async function enrichInvoiceDetail(invoice: {
  customerId: number;
  customerRef?: Types.ObjectId | null;
  contractRef?: Types.ObjectId | null;
  workOrderRef?: Types.ObjectId | null;
}): Promise<{
  customer: InvoiceCustomerSummary | null;
  serviceAddress: InvoiceServiceAddress | null;
}> {
  let customer: InvoiceCustomerSummary | null = null;
  let serviceAddress: InvoiceServiceAddress | null = null;

  if (invoice.customerRef) {
    const [cust, primaryContact] = await Promise.all([
      Customer.findById(invoice.customerRef).lean(),
      CustomerContact.findOne({
        customerRef: invoice.customerRef,
        isPrimary: true,
      })
        .select("phone email")
        .lean(),
    ]);

    if (cust) {
      customer = {
        name: customerDisplayName(cust) || `Customer #${cust.legacyId}`,
        accountNumber: cust.legacyId ?? invoice.customerId,
        address: cust.address ?? "",
        city: cust.city ?? "",
        state: cust.state ?? "",
        zip: cust.zip ?? "",
        phone: (primaryContact?.phone || cust.phone || "").trim(),
        email: (primaryContact?.email || cust.email || "").trim(),
      };
    }
  }

  let addressRef: Types.ObjectId | null | undefined;
  if (invoice.contractRef) {
    const contract = await Contract.findById(invoice.contractRef)
      .select("addressRef")
      .lean();
    addressRef = contract?.addressRef ?? null;
  } else if (invoice.workOrderRef) {
    const wo = await WorkOrder.findById(invoice.workOrderRef)
      .select("addressRef")
      .lean();
    addressRef = wo?.addressRef ?? null;
  }

  if (addressRef) {
    const site = await CustomerAddress.findById(addressRef).lean();
    if (site) {
      serviceAddress = {
        label: site.label || undefined,
        address: site.address ?? "",
        city: site.city ?? "",
        state: site.state ?? "",
        zip: site.zip ?? "",
      };
    }
  }

  return { customer, serviceAddress };
}

export async function resolveCustomerRefsForAuthUser(
  userId: string,
): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(userId)) return [];
  const contacts = await CustomerContact.find({
    userRef: new Types.ObjectId(userId),
  })
    .select("customerRef")
    .lean();
  return contacts
    .map((c) => c.customerRef)
    .filter((id): id is Types.ObjectId => Boolean(id));
}

function isStaff(role?: string): boolean {
  return Boolean(role && STAFF_ROLES.has(role));
}

export { mintPayToken } from "../utils/payToken";

export async function getInvoices(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const filter: Record<string, unknown> = {};
    const { status, customerRef, contractRef, workOrderRef } = req.query;

    if (typeof status === "string" && status) {
      filter.status = status;
    }
    if (typeof contractRef === "string" && contractRef) {
      filter.contractRef = contractRef;
    }
    if (typeof workOrderRef === "string" && workOrderRef) {
      filter.workOrderRef = workOrderRef;
    }

    if (isStaff(req.user?.role)) {
      if (typeof customerRef === "string" && customerRef) {
        filter.customerRef = customerRef;
      }
    } else if (req.user?.id) {
      const refs = await resolveCustomerRefsForAuthUser(req.user.id);
      if (refs.length === 0) {
        res.json({ invoices: [] });
        return;
      }
      filter.customerRef = { $in: refs };
    } else {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const invoices = await Invoice.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ invoices: invoices.map(toPublicInvoice) });
  } catch {
    res.status(500).json({ message: "Failed to list invoices" });
  }
}

export async function getInvoiceById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    if (!isStaff(req.user?.role)) {
      const refs = await resolveCustomerRefsForAuthUser(req.user?.id ?? "");
      if (
        !invoice.customerRef ||
        !refs.some((r) => String(r) === String(invoice.customerRef))
      ) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
    }

    const enrichment = await enrichInvoiceDetail(invoice);
    res.json({
      invoice: {
        ...toPublicInvoice(invoice),
        ...enrichment,
      },
    });
  } catch {
    res.status(500).json({ message: "Failed to load invoice" });
  }
}

export async function createInvoice(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    let customerId: number;
    let customerRef: Types.ObjectId | undefined;
    let amountCents: number;
    let lineItems: { description: string; amountCents: number }[];
    let contractRef: Types.ObjectId | undefined;
    let workOrderRef: Types.ObjectId | undefined;
    let templateRef: Types.ObjectId | undefined;
    let dueDate: Date | null = data.dueDate ? new Date(data.dueDate) : null;
    const metadata: Record<string, unknown> = {};

    if (
      data.sourceType === "contract_renewal" ||
      data.sourceType === "contract_initial"
    ) {
      if (!data.contractRef) {
        res.status(400).json({ message: "contractRef is required" });
        return;
      }
      const contract = await Contract.findById(data.contractRef);
      if (!contract) {
        res.status(404).json({ message: "Contract not found" });
        return;
      }
      customerId = contract.customerId;
      customerRef = contract.customerRef;
      contractRef = contract._id as Types.ObjectId;
      templateRef = contract.templateId ?? undefined;
      metadata.durationMonths = contract.durationMonths;
      if (contract.renewalDueDate) {
        dueDate = dueDate ?? contract.renewalDueDate;
        metadata.renewalDueDate = contract.renewalDueDate;
      }

      let cost = 0;
      if (contract.templateId) {
        const template = await ContractTemplate.findById(contract.templateId)
          .select("cost label")
          .lean();
        cost = template?.cost ?? 0;
        if (template) {
          metadata.templateLabel = template.label;
        }
      }
      if (data.amountCents != null) {
        amountCents = data.amountCents;
      } else {
        amountCents = dollarsToCents(cost);
      }
      if (amountCents <= 0) {
        res.status(400).json({
          message:
            "Invoice amount must be greater than zero. Set a template cost or pass amountCents.",
        });
        return;
      }

      const label =
        data.sourceType === "contract_renewal"
          ? "Contract renewal"
          : "Contract";
      lineItems = [
        {
          description:
            data.description ||
            `${label}${metadata.templateLabel ? `: ${metadata.templateLabel}` : ""}`,
          amountCents,
        },
      ];

      if (data.sourceType === "contract_renewal") {
        const existingOpen = await Invoice.findOne({
          contractRef: contract._id,
          sourceType: "contract_renewal",
          status: { $in: ["open", "draft"] },
        });
        if (existingOpen) {
          res.status(409).json({
            message: "An open renewal invoice already exists for this contract",
            invoice: toPublicInvoice(existingOpen),
          });
          return;
        }
      }
    } else {
      if (!data.workOrderRef) {
        res.status(400).json({ message: "workOrderRef is required" });
        return;
      }
      const wo = await WorkOrder.findById(data.workOrderRef);
      if (!wo) {
        res.status(404).json({ message: "Work order not found" });
        return;
      }
      customerId = wo.customerId;
      customerRef = wo.customerRef;
      workOrderRef = wo._id as Types.ObjectId;
      amountCents =
        data.amountCents != null
          ? data.amountCents
          : dollarsToCents(wo.total || 0);
      if (amountCents <= 0) {
        res.status(400).json({
          message: "Work order total must be greater than zero to invoice",
        });
        return;
      }
      const builtItems = workOrderInvoiceLineItems(wo);
      lineItems =
        builtItems.length > 0
          ? builtItems
          : [
              {
                description:
                  data.description ||
                  `Work order${wo.descPerform ? `: ${wo.descPerform}` : ""}`,
                amountCents,
              },
            ];
      if (data.description && lineItems.length === 1) {
        lineItems[0].description = data.description;
      }

      const existingOpen = await Invoice.findOne({
        workOrderRef: wo._id,
        status: { $in: ["open", "draft"] },
      });
      if (existingOpen) {
        res.status(409).json({
          message: "An open invoice already exists for this work order",
          invoice: toPublicInvoice(existingOpen),
        });
        return;
      }
    }

    const issuedAt = new Date();
    const invoice = await Invoice.create({
      number: await nextInvoiceNumber(issuedAt),
      customerId,
      customerRef,
      sourceType: data.sourceType,
      contractRef: contractRef ?? null,
      workOrderRef: workOrderRef ?? null,
      templateRef: templateRef ?? null,
      lineItems,
      amountCents,
      currency: "USD",
      status: "open",
      dueDate,
      issuedAt,
      metadata,
    });

    logNotificationAsync({
      entityType: "invoice",
      action: "created",
      entityId: String(invoice._id),
      customerRef: customerRef ?? null,
      summary: `Invoice ${invoice.number} created`,
      ...actorFromRequest(req.user),
    });

    res.status(201).json({ invoice: toPublicInvoice(invoice) });
  } catch (err) {
    console.error("[invoices] create failed", err);
    res.status(500).json({ message: "Failed to create invoice" });
  }
}

export async function startInvoiceCheckout(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    if (invoice.status === "paid") {
      res.status(400).json({ message: "Invoice is already paid" });
      return;
    }
    if (invoice.status === "void") {
      res.status(400).json({ message: "Invoice is void" });
      return;
    }

    if (!isStaff(req.user?.role) && req.user?.id) {
      const refs = await resolveCustomerRefsForAuthUser(req.user.id);
      if (
        !invoice.customerRef ||
        !refs.some((r) => String(r) === String(invoice.customerRef))
      ) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
    }

    const { adapter, account } = await resolveCheckoutProviderForInvoice(
      invoice.customerRef,
    );
    const redirectUrl = `${env.clientUrl.replace(/\/$/, "")}/checkout/complete?invoiceId=${invoice._id}`;
    const buyer = await resolveCheckoutBuyer(invoice.customerRef);

    const result = await adapter.createCheckout({
      invoice,
      account,
      redirectUrl,
      buyer,
    });

    invoice.paymentProvider = adapter.name;
    invoice.paymentProviderAccountRef = account.account._id as Types.ObjectId;
    invoice.providerCheckoutId = result.checkoutId;
    invoice.providerOrderId = result.orderId ?? invoice.providerOrderId;
    invoice.status = "open";
    await invoice.save();

    res.json({
      url: result.url,
      invoice: toPublicInvoice(invoice),
    });
  } catch (err) {
    console.error("[invoices] checkout failed", err);
    res.status(500).json({
      message:
        err instanceof Error ? err.message : "Failed to start checkout",
    });
  }
}

export async function createInvoicePayLink(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    if (invoice.status === "paid" || invoice.status === "void") {
      res.status(400).json({
        message: `Cannot create pay link for ${invoice.status} invoice`,
      });
      return;
    }

    const { token, hash, expiresAt } = mintPayToken();
    invoice.payTokenHash = hash;
    invoice.payTokenExpiresAt = expiresAt;
    await invoice.save();

    // Static export uses query params (not dynamic path segments).
    const payUrl = buildPayUrl(token);
    res.json({
      payUrl,
      expiresAt,
      invoice: toPublicInvoice(invoice),
    });
  } catch {
    res.status(500).json({ message: "Failed to create pay link" });
  }
}

export async function getInvoiceByPayToken(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const token = String(req.params.token ?? "");
    if (!token) {
      res.status(400).json({ message: "Token required" });
      return;
    }
    const hash = hashPayToken(token);
    const invoice = await Invoice.findOne({ payTokenHash: hash }).lean();
    if (!invoice) {
      res.status(404).json({ message: "Pay link not found" });
      return;
    }
    if (
      invoice.payTokenExpiresAt &&
      new Date(invoice.payTokenExpiresAt) < new Date()
    ) {
      res.status(410).json({ message: "Pay link expired" });
      return;
    }

    res.json({
      invoice: {
        ...toPublicInvoice(invoice),
      },
    });
  } catch {
    res.status(500).json({ message: "Failed to resolve pay link" });
  }
}

export async function startCheckoutByPayToken(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const token = String(req.params.token ?? "");
    const hash = hashPayToken(token);
    const invoice = await Invoice.findOne({ payTokenHash: hash });
    if (!invoice) {
      res.status(404).json({ message: "Pay link not found" });
      return;
    }
    if (
      invoice.payTokenExpiresAt &&
      invoice.payTokenExpiresAt < new Date()
    ) {
      res.status(410).json({ message: "Pay link expired" });
      return;
    }
    if (invoice.status === "paid") {
      res.status(400).json({ message: "Invoice is already paid" });
      return;
    }

    const { adapter, account } = await resolveCheckoutProviderForInvoice(
      invoice.customerRef,
    );
    const redirectUrl = `${env.clientUrl.replace(/\/$/, "")}/checkout/complete?invoiceId=${invoice._id}`;
    const buyer = await resolveCheckoutBuyer(invoice.customerRef);
    const result = await adapter.createCheckout({
      invoice,
      account,
      redirectUrl,
      buyer,
    });

    invoice.paymentProvider = adapter.name;
    invoice.paymentProviderAccountRef = account.account._id as Types.ObjectId;
    invoice.providerCheckoutId = result.checkoutId;
    invoice.providerOrderId = result.orderId ?? invoice.providerOrderId;
    await invoice.save();

    res.json({ url: result.url, invoice: toPublicInvoice(invoice) });
  } catch (err) {
    console.error("[pay] checkout failed", err);
    res.status(500).json({
      message:
        err instanceof Error ? err.message : "Failed to start checkout",
    });
  }
}

// Re-export helpers used elsewhere
export { markInvoicePaid };
