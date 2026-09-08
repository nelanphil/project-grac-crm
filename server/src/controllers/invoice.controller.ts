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
  ensureOpenInvoiceForWorkOrder,
  InvoiceAmountError,
  markInvoicePaid,
  nextInvoiceNumber,
} from "../services/invoice.service";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import { resolveCheckoutProviderForInvoice } from "../payments/registry";
import { resolveCheckoutBuyer } from "../payments/checkoutBuyer";
import { hashPayToken } from "../utils/payToken";
import { paymentNoteForInvoiceIds } from "../utils/paymentLinkForCustomer";
import {
  buildCheckoutCompleteUrl,
  buildCheckoutUrl,
  getOrCreateCheckoutKey,
} from "../utils/checkoutKey";
import { resolveCustomerRefsForAuthUser } from "../utils/resolveCustomerLogin";

export { resolveCustomerRefsForAuthUser };

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
    originalAmountCents:
      typeof d.originalAmountCents === "number" ? d.originalAmountCents : null,
    discountCode: d.discountCode ? String(d.discountCode) : null,
    discountCents: Number(d.discountCents) || 0,
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

function isStaff(role?: string): boolean {
  return Boolean(role && STAFF_ROLES.has(role));
}

export { mintPayToken } from "../utils/payToken";

const INVOICE_PAGE_SIZES = [5, 50, 150, 250, 500];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function customerRefsMatchingSearch(
  search: string,
): Promise<Types.ObjectId[]> {
  const re = new RegExp(escapeRegex(search), "i");
  const digits = search.replace(/\D/g, "");
  const customerOr: Record<string, unknown>[] = [
    { accountName: re },
    { first: re },
    { last: re },
    { email: re },
    { phone: re },
  ];
  if (digits) {
    customerOr.push({ phoneDigits: new RegExp(escapeRegex(digits), "i") });
  }
  const contactOr: Record<string, unknown>[] = [
    { first: re },
    { last: re },
    { email: re },
    { phone: re },
  ];

  const [customers, contacts] = await Promise.all([
    Customer.find({ $or: customerOr }).select("_id").lean(),
    CustomerContact.find({ $or: contactOr }).select("customerRef").lean(),
  ]);

  const ids = new Set<string>();
  for (const customer of customers) ids.add(String(customer._id));
  for (const contact of contacts) {
    if (contact.customerRef) ids.add(String(contact.customerRef));
  }
  return [...ids].map((id) => new Types.ObjectId(id));
}

async function invoiceListNames(
  invoices: Array<{ customerRef?: Types.ObjectId | null }>,
): Promise<Map<string, { customerName: string; contactName: string }>> {
  const unique = [
    ...new Set(
      invoices
        .map((invoice) =>
          invoice.customerRef ? String(invoice.customerRef) : "",
        )
        .filter(Boolean),
    ),
  ];
  if (unique.length === 0) return new Map();

  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const [customers, contacts] = await Promise.all([
    Customer.find({ _id: { $in: objectIds } })
      .select("accountName first last legacyId")
      .lean(),
    CustomerContact.find({
      customerRef: { $in: objectIds },
      isPrimary: true,
    })
      .select("customerRef first last")
      .lean(),
  ]);

  const contactByCustomer = new Map(
    contacts.map((contact) => [
      String(contact.customerRef),
      `${contact.first ?? ""} ${contact.last ?? ""}`.trim(),
    ]),
  );

  const names = new Map<string, { customerName: string; contactName: string }>();
  for (const customer of customers) {
    const id = String(customer._id);
    names.set(id, {
      customerName:
        customerDisplayName(customer) || `Customer #${customer.legacyId}`,
      contactName: contactByCustomer.get(id) ?? "",
    });
  }
  return names;
}

export async function getInvoices(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const filter: Record<string, unknown> = {};
    const { status, customerRef, contractRef, workOrderRef } = req.query;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const pageRaw = typeof req.query.page === "string" ? req.query.page : "";
    const paginate = Boolean(pageRaw);

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

    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const matchingRefs = await customerRefsMatchingSearch(search);
      const searchOr: Record<string, unknown>[] = [{ number: re }];
      if (matchingRefs.length > 0) {
        searchOr.push({ customerRef: { $in: matchingRefs } });
      }
      filter.$or = searchOr;
    }

    if (!paginate) {
      const invoices = await Invoice.find(filter)
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      res.json({ invoices: invoices.map(toPublicInvoice) });
      return;
    }

    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10);
    const pageSize = INVOICE_PAGE_SIZES.includes(pageSizeRaw)
      ? pageSizeRaw
      : 50;

    const [total, invoices] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const names = await invoiceListNames(invoices);

    res.json({
      invoices: invoices.map((invoice) => {
        const extra = invoice.customerRef
          ? names.get(String(invoice.customerRef))
          : undefined;
        return {
          ...toPublicInvoice(invoice),
          customerName: extra?.customerName ?? "",
          contactName: extra?.contactName ?? "",
        };
      }),
      total,
      page,
      pageSize,
    });
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
      if (wo.paid && !data.allowPaidBypass) {
        res.status(409).json({
          message: "Work order is already paid",
        });
        return;
      }
      try {
        const { invoice, created } = await ensureOpenInvoiceForWorkOrder(wo, {
          amountCents: data.amountCents,
          description: data.description,
          actor: actorFromRequest(req.user),
        });
        if (!created) {
          res.status(409).json({
            message: "An open invoice already exists for this work order",
            invoice: toPublicInvoice(invoice),
          });
          return;
        }
        res.status(201).json({ invoice: toPublicInvoice(invoice) });
        return;
      } catch (err) {
        if (err instanceof InvoiceAmountError) {
          res.status(400).json({ message: err.message });
          return;
        }
        throw err;
      }
    }

    const issuedAt = new Date();
    const invoice = await Invoice.create({
      number: await nextInvoiceNumber(issuedAt),
      customerId,
      customerRef,
      sourceType: data.sourceType,
      contractRef: contractRef ?? null,
      workOrderRef: null,
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
    const redirectUrl = buildCheckoutCompleteUrl(String(invoice._id));
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

    if (!invoice.customerRef) {
      res.status(400).json({ message: "Invoice has no customer" });
      return;
    }

    const key = await getOrCreateCheckoutKey(String(invoice.customerRef));
    const payUrl = buildCheckoutUrl(key, { invoiceId: String(invoice._id) });
    res.json({
      payUrl,
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
    const invoices = await Invoice.find({ payTokenHash: hash })
      .sort({ issuedAt: 1 })
      .lean();
    if (invoices.length === 0) {
      res.status(404).json({ message: "Pay link not found" });
      return;
    }
    if (
      invoices.some(
        (invoice) =>
          invoice.payTokenExpiresAt &&
          new Date(invoice.payTokenExpiresAt) < new Date(),
      )
    ) {
      res.status(410).json({ message: "Pay link expired" });
      return;
    }

    const publicInvoices = invoices.map((invoice) => toPublicInvoice(invoice));
    const totalCents = invoices.reduce(
      (sum, invoice) =>
        invoice.status === "paid" || invoice.status === "void"
          ? sum
          : sum + (invoice.amountCents || 0),
      0,
    );

    res.json({
      invoice: publicInvoices[0],
      invoices: publicInvoices,
      totalCents,
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
    const invoices = await Invoice.find({ payTokenHash: hash }).sort({
      issuedAt: 1,
    });
    if (invoices.length === 0) {
      res.status(404).json({ message: "Pay link not found" });
      return;
    }
    if (
      invoices.some(
        (invoice) =>
          invoice.payTokenExpiresAt && invoice.payTokenExpiresAt < new Date(),
      )
    ) {
      res.status(410).json({ message: "Pay link expired" });
      return;
    }
    const unpaid = invoices.filter(
      (invoice) => invoice.status !== "paid" && invoice.status !== "void",
    );
    if (unpaid.length === 0) {
      res.status(400).json({ message: "Invoice is already paid" });
      return;
    }

    const primary = unpaid[0];
    const amountCents = unpaid.reduce(
      (sum, invoice) => sum + (invoice.amountCents || 0),
      0,
    );
    const invoiceIds = unpaid.map((invoice) => String(invoice._id));
    const { adapter, account } = await resolveCheckoutProviderForInvoice(
      primary.customerRef,
    );
    const redirectUrl = buildCheckoutCompleteUrl(String(primary._id));
    const buyer = await resolveCheckoutBuyer(primary.customerRef);
    const result = await adapter.createCheckout({
      invoice: primary,
      account,
      redirectUrl,
      buyer,
      amountCents,
      paymentNote: paymentNoteForInvoiceIds(invoiceIds),
      checkoutName:
        unpaid.length > 1
          ? `Outstanding invoices (${unpaid.length})`
          : undefined,
      checkoutDescription:
        unpaid.length > 1
          ? unpaid.map((invoice) => invoice.number).join(", ")
          : undefined,
    });

    for (const invoice of unpaid) {
      invoice.paymentProvider = adapter.name;
      invoice.paymentProviderAccountRef = account.account._id as Types.ObjectId;
      invoice.providerCheckoutId = result.checkoutId;
      invoice.providerOrderId = result.orderId ?? invoice.providerOrderId;
      await invoice.save();
    }

    res.json({ url: result.url, invoice: toPublicInvoice(primary) });
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
