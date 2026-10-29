import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  Invoice,
  IInvoice,
  toPublicOfflinePayment,
} from "../models/mongo/Invoice";
import { Contract } from "../models/mongo/Contract";
import {
  includingDeletedWorkOrders,
  WorkOrder,
} from "../models/mongo/WorkOrder";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import {
  Customer,
  excludeDeletedCustomerRefs,
  loadDeletedCustomerIds,
} from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  bulkInvoiceStatusSchema,
  bulkRenewalWorkOrderSchema,
  createInvoiceSchema,
  linkRenewalWorkOrderSchema,
  updateInvoiceTaxSchema,
} from "../schemas/invoice.schema";
import {
  dollarsToCents,
  ensureOpenInvoiceForWorkOrder,
  findPendingCompletedWorkOrderInvoices,
  InvoiceAmountError,
  invoiceTaxFromCurrentRate,
  markInvoicePaid,
  nextInvoiceNumber,
  reopenInvoice,
  WORK_ORDER_REOPENED_REASON,
  WorkOrderNotReadyError,
} from "../services/invoice.service";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  INVOICE_OPEN_THROTTLE_MS,
  paymentSourceEventId,
  recordInvoiceEventAsync,
} from "../services/invoiceEvent.service";
import { loadInvoiceActivity } from "../services/invoiceActivity.service";
import { sendRenewalScheduleEmail } from "../services/renewalScheduleEmail.service";
import {
  dismissPaidRenewal,
  ensureRenewalWorkOrder,
  findPaidRenewalsWithoutWorkOrder,
  isContractServiceInvoice,
  linkRenewalWorkOrder,
  renewalVisitState,
  RenewalWorkOrderError,
  type RenewalWorkOrderActor,
} from "../services/renewalWorkOrder.service";
import {
  getJourneySnapshotForInvoice,
  getJourneyVisitForInvoice,
} from "../services/paymentJourney.service";
import { resolveCheckoutProviderForInvoice } from "../payments/registry";
import { resolveCheckoutBuyer } from "../payments/checkoutBuyer";
import { hashPayToken } from "../utils/payToken";
import { paymentNoteForInvoiceIds } from "../utils/paymentLinkForCustomer";
import {
  buildCheckoutCompleteUrl,
  buildPosCallbackUrl,
} from "../utils/checkoutKey";
import { resolveCustomerRefsForAuthUser } from "../utils/resolveCustomerLogin";
import { listVisibleWorkOrderNotes } from "./workOrderNote.controller";
import { roundMoney } from "../services/serviceTicket";
import {
  computeTaxAmount,
  normalizeTaxRatePercent,
  taxCentsFromDollars,
} from "../services/taxSettings";
import { ensureDefaultInvoiceTemplate } from "../models/mongo/InvoiceTemplate";
import {
  invoiceBlocksSchema,
  sanitizeInvoiceBlocks,
} from "../schemas/invoiceTemplate.schema";
import { defaultInvoiceBlocks } from "../utils/defaultInvoiceBlocks";
import { isStaffRole } from "../utils/roles";
import { buildTokenSearchFilter } from "../utils/textSearch";
import { createScopedPaymentLink } from "../services/checkoutLink.service";
import { CheckoutError } from "../services/checkout.service";
import {
  PosChargeError,
  signPosChargeState,
  squarePosApplicationId,
  verifyPosChargeState,
} from "../services/squarePos.service";
import {
  checkPosTransaction,
  flagPosChargeForReview,
  reconcilePosCharge,
  resolvePosSquareAccount,
} from "../services/posReconcile.service";
import { settleInvoicePayment } from "../services/invoiceSettlement.service";
import { resolvePublicApiBase } from "../utils/publicUrl";

export { resolveCustomerRefsForAuthUser };

function toPublicPosCharge(value: IInvoice["posCharge"]) {
  if (!value?.startedAt) return null;
  return {
    status: value.status,
    startedAt: value.startedAt,
    amountCents: value.amountCents,
    hasTransaction: Boolean(value.transactionId),
    lastCheckedAt: value.lastCheckedAt ?? null,
    reviewReason: value.reviewReason ?? null,
  };
}

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
    taxRatePercent: Number(d.taxRatePercent) || 0,
    taxCents: Number(d.taxCents) || 0,
    taxOverridden: Boolean(d.taxOverridden),
    currency: d.currency,
    status: d.status,
    dueDate: d.dueDate,
    issuedAt: d.issuedAt,
    paidAt: d.paidAt,
    paymentProvider: d.paymentProvider,
    providerCheckoutId: d.providerCheckoutId,
    providerOrderId: d.providerOrderId,
    providerPaymentId: d.providerPaymentId,
    offlinePayment: toPublicOfflinePayment(
      d.offlinePayment as IInvoice["offlinePayment"],
    ),
    hasPayLink: Boolean(d.payTokenHash),
    payTokenExpiresAt: d.payTokenExpiresAt,
    posCharge: toPublicPosCharge(d.posCharge as IInvoice["posCharge"]),
    metadata: d.metadata ?? {},
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function hideOfflineProof<
  T extends { offlinePayment: { proofUrl: string | null } | null },
>(invoice: T): T {
  if (!invoice.offlinePayment?.proofUrl) return invoice;
  return {
    ...invoice,
    offlinePayment: { ...invoice.offlinePayment, proofUrl: null },
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
  customerRef?: string;
  workOrderNotes?: Awaited<ReturnType<typeof listVisibleWorkOrderNotes>>;
}> {
  let customer: InvoiceCustomerSummary | null = null;
  let serviceAddress: InvoiceServiceAddress | null = null;

  const resolvedCustomer = invoice.customerRef
    ? await Customer.findById(invoice.customerRef).lean()
    : typeof invoice.customerId === "number"
      ? await Customer.findOne({
          legacyId: invoice.customerId,
          deletedAt: null,
          $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
        }).lean()
      : null;

  if (resolvedCustomer) {
    const primaryContact = await CustomerContact.findOne({
      customerRef: resolvedCustomer._id,
      isPrimary: true,
    })
      .select("phone email")
      .lean();

    customer = {
      name:
        customerDisplayName(resolvedCustomer) ||
        `Customer #${resolvedCustomer.legacyId}`,
      accountNumber: resolvedCustomer.legacyId ?? invoice.customerId,
      address: resolvedCustomer.address ?? "",
      city: resolvedCustomer.city ?? "",
      state: resolvedCustomer.state ?? "",
      zip: resolvedCustomer.zip ?? "",
      phone: (primaryContact?.phone || resolvedCustomer.phone || "").trim(),
      email: (primaryContact?.email || resolvedCustomer.email || "").trim(),
    };
  }

  let addressRef: Types.ObjectId | null | undefined;
  if (invoice.contractRef) {
    const contract = await Contract.findById(invoice.contractRef)
      .select("addressRef")
      .lean();
    addressRef = contract?.addressRef ?? null;
  } else if (invoice.workOrderRef) {
    const wo = await includingDeletedWorkOrders(
      WorkOrder.findById(invoice.workOrderRef).select("addressRef"),
    ).lean();
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

  const workOrderNotes = invoice.workOrderRef
    ? await listVisibleWorkOrderNotes(invoice.workOrderRef)
    : [];

  return {
    customer,
    serviceAddress,
    workOrderNotes,
    ...(resolvedCustomer && !invoice.customerRef
      ? { customerRef: String(resolvedCustomer._id) }
      : {}),
  };
}

function isStaff(user: Parameters<typeof isStaffRole>[0]): boolean {
  return isStaffRole(user);
}

export { mintPayToken } from "../utils/payToken";

const INVOICE_PAGE_SIZES = [5, 50, 150, 250, 500];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function customerRefsMatchingSearch(
  search: string,
): Promise<Types.ObjectId[]> {
  const digits = search.replace(/\D/g, "");
  const customerOr: Record<string, unknown>[] = [];
  const customerTokens = buildTokenSearchFilter(search, [
    "accountName",
    "first",
    "last",
    "email",
    "phone",
  ]);
  if (customerTokens) customerOr.push(customerTokens);
  if (digits) {
    customerOr.push({ phoneDigits: new RegExp(escapeRegex(digits), "i") });
  }
  const contactOr: Record<string, unknown>[] = [];
  const contactTokens = buildTokenSearchFilter(search, [
    "first",
    "last",
    "email",
    "phone",
  ]);
  if (contactTokens) contactOr.push(contactTokens);
  if (customerOr.length === 0 || contactOr.length === 0) return [];

  const [customers, contacts] = await Promise.all([
    Customer.find({ deletedAt: null, $or: customerOr }).select("_id").lean(),
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

    if (isStaff(req.user)) {
      const hideDeleted = excludeDeletedCustomerRefs(await loadDeletedCustomerIds());
      if (Object.keys(hideDeleted).length > 0) {
        filter.$and = [
          ...(Array.isArray(filter.$and) ? (filter.$and as object[]) : []),
          hideDeleted,
        ];
      }
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
      const names = await invoiceListNames(invoices);
      res.json({
        invoices: invoices.map((invoice) => {
          const extra = invoice.customerRef
            ? names.get(String(invoice.customerRef))
            : undefined;
          const pub = toPublicInvoice(invoice);
          return {
            ...(isStaff(req.user) ? pub : hideOfflineProof(pub)),
            customerName: extra?.customerName ?? "",
            contactName: extra?.contactName ?? "",
          };
        }),
      });
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
        const pub = toPublicInvoice(invoice);
        return {
          ...(isStaff(req.user) ? pub : hideOfflineProof(pub)),
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

function withInvoiceNames(
  invoices: Array<Record<string, unknown>>,
  names: Map<string, { customerName: string; contactName: string }>,
) {
  return invoices.map((invoice) => {
    const customerRef = invoice.customerRef ? String(invoice.customerRef) : "";
    const extra = customerRef ? names.get(customerRef) : undefined;
    return {
      ...toPublicInvoice(invoice),
      customerName: extra?.customerName ?? "",
      contactName: extra?.contactName ?? "",
    };
  });
}

export async function getPendingPayments(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const pageRaw = typeof req.query.page === "string" ? req.query.page : "";
    const paginate = Boolean(pageRaw);
    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10);
    const pageSize = INVOICE_PAGE_SIZES.includes(pageSizeRaw)
      ? pageSizeRaw
      : 50;
    const customerRefs = search ? await customerRefsMatchingSearch(search) : [];
    const { invoices, total } = await findPendingCompletedWorkOrderInvoices({
      number: search ? new RegExp(escapeRegex(search), "i") : undefined,
      customerRefs: search ? customerRefs : undefined,
      skip: paginate ? (page - 1) * pageSize : undefined,
      limit: paginate ? pageSize : undefined,
    });
    const names = await invoiceListNames(
      invoices as Array<{ customerRef?: Types.ObjectId | null }>,
    );
    res.json({
      invoices: withInvoiceNames(invoices, names),
      total,
      ...(paginate ? { page, pageSize } : {}),
    });
  } catch (err) {
    console.error("[invoices] pending payments failed", err);
    res.status(500).json({ message: "Failed to list pending payments" });
  }
}

function renewalActor(req: AuthRequest): RenewalWorkOrderActor {
  return { actorUserId: req.user?.id ?? null, actorName: null };
}

function renewalError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof RenewalWorkOrderError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  console.error(`[invoices] ${fallback}`, err);
  res.status(500).json({ message: fallback });
}

function contractLabelOf(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const label = (metadata as { templateLabel?: unknown }).templateLabel;
  return typeof label === "string" ? label : "";
}

export async function getPaidRenewals(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const pageRaw = typeof req.query.page === "string" ? req.query.page : "";
    const paginate = Boolean(pageRaw);
    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10);
    const pageSize = INVOICE_PAGE_SIZES.includes(pageSizeRaw)
      ? pageSizeRaw
      : 50;
    const customerRefs = search ? await customerRefsMatchingSearch(search) : [];
    const { invoices, total } = await findPaidRenewalsWithoutWorkOrder({
      number: search ? new RegExp(escapeRegex(search), "i") : undefined,
      customerRefs: search ? customerRefs : undefined,
      skip: paginate ? (page - 1) * pageSize : undefined,
      limit: paginate ? pageSize : undefined,
      includeUnscheduled: true,
    });
    const names = await invoiceListNames(
      invoices as Array<{ customerRef?: Types.ObjectId | null }>,
    );
    res.json({
      invoices: withInvoiceNames(invoices, names).map((invoice) => ({
        ...invoice,
        contractLabel: contractLabelOf(invoice.metadata),
      })),
      total,
      ...(paginate ? { page, pageSize } : {}),
    });
  } catch (err) {
    console.error("[invoices] paid renewals failed", err);
    res.status(500).json({ message: "Failed to list paid renewals" });
  }
}

export async function createRenewalWorkOrderForInvoice(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const workOrder = await ensureRenewalWorkOrder(invoice, renewalActor(req));
    if (!workOrder) {
      res.status(400).json({
        message: "Could not create a work order for this invoice.",
      });
      return;
    }
    res.json({ workOrder });
  } catch (err) {
    renewalError(res, err, "Failed to create the work order");
  }
}

export async function bulkCreateRenewalWorkOrders(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const parsed = bulkRenewalWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message || "Validation failed",
      });
      return;
    }
    const actor = renewalActor(req);
    const created: Array<{
      invoiceId: string;
      workOrderId: string;
      number: string;
    }> = [];
    const failed: Array<{ invoiceId: string; message: string }> = [];
    for (const invoiceId of parsed.data.ids) {
      try {
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
          failed.push({ invoiceId, message: "Invoice not found" });
          continue;
        }
        const workOrder = await ensureRenewalWorkOrder(invoice, actor);
        if (!workOrder) {
          failed.push({
            invoiceId,
            message: "Could not create a work order for this invoice.",
          });
          continue;
        }
        created.push({
          invoiceId,
          workOrderId: workOrder.workOrderId,
          number: workOrder.number,
        });
      } catch (err) {
        failed.push({
          invoiceId,
          message:
            err instanceof RenewalWorkOrderError
              ? err.message
              : "Could not create a work order for this invoice.",
        });
      }
    }
    res.json({ created, failed });
  } catch (err) {
    renewalError(res, err, "Failed to create work orders");
  }
}

export async function linkRenewalWorkOrderForInvoice(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const parsed = linkRenewalWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message || "Validation failed",
      });
      return;
    }
    const workOrder = await linkRenewalWorkOrder({
      invoiceId: String(req.params.id ?? ""),
      workOrderId: parsed.data.workOrderId,
      workOrderNumber: parsed.data.workOrderNumber,
      actor: renewalActor(req),
    });
    res.json({ workOrder });
  } catch (err) {
    renewalError(res, err, "Failed to link the work order");
  }
}

export async function dismissPaidRenewalInvoice(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    await dismissPaidRenewal({
      invoiceId: String(req.params.id ?? ""),
      actor: renewalActor(req),
    });
    res.json({ dismissed: true });
  } catch (err) {
    renewalError(res, err, "Failed to dismiss this renewal");
  }
}

export async function resendRenewalScheduleEmail(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const result = await sendRenewalScheduleEmail(invoice, { force: true });
    if (result.status === "sent") {
      res.json({ message: "Scheduling email sent." });
      return;
    }
    const alreadyScheduled =
      result.status === "skipped" &&
      result.reason === "This renewal visit is already scheduled.";
    res.status(result.status === "failed" ? 502 : alreadyScheduled ? 409 : 400).json({
      message:
        result.status === "failed" ? result.error : result.reason,
    });
  } catch (err) {
    console.error("[invoices] renewal schedule email failed", err);
    res.status(500).json({ message: "Failed to send the scheduling email" });
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

    if (!isStaff(req.user)) {
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
    const pub = {
      ...toPublicInvoice(invoice),
      ...enrichment,
    };
    const renewalVisit =
      isStaff(req.user) &&
      isContractServiceInvoice(invoice.sourceType) &&
      invoice.status === "paid"
        ? {
            ...(await renewalVisitState(invoice)),
            scheduleEmailSentAt: invoice.renewalScheduleEmailSentAt ?? null,
          }
        : null;
    res.json({
      invoice: isStaff(req.user)
        ? { ...pub, ...(renewalVisit ? { renewalVisit } : {}) }
        : hideOfflineProof(pub),
    });
  } catch {
    res.status(500).json({ message: "Failed to load invoice" });
  }
}

export async function getInvoiceActivity(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const id = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid invoice id" });
      return;
    }
    const invoice = await Invoice.findById(id)
      .select(
        "number status paidAt amountCents paymentProvider paymentProviderAccountRef providerPaymentId providerOrderId offlinePayment posCharge customerRef issuedAt createdAt",
      )
      .lean();
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    res.json(await loadInvoiceActivity(invoice));
  } catch (err) {
    console.error("[invoices] activity failed", err);
    res.status(500).json({ message: "Failed to load invoice activity" });
  }
}

export async function getInvoiceVisit(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const id = String(req.params.id ?? "");
    const sessionId = String(req.params.sessionId ?? "");
    if (!Types.ObjectId.isValid(id) || !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId)) {
      res.status(400).json({ message: "Invalid visit" });
      return;
    }
    const visit = await getJourneyVisitForInvoice(id, sessionId);
    if (!visit) {
      res.status(404).json({ message: "Visit not found" });
      return;
    }
    res.json({ visit });
  } catch (err) {
    console.error("[invoices] visit failed", err);
    res.status(500).json({ message: "Failed to load visit" });
  }
}

export async function getInvoiceVisitSnapshot(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const id = String(req.params.id ?? "");
    const sessionId = String(req.params.sessionId ?? "");
    const snapshotId = String(req.params.snapshotId ?? "");
    if (
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(snapshotId) ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId)
    ) {
      res.status(400).json({ message: "Invalid snapshot" });
      return;
    }
    const snapshot = await getJourneySnapshotForInvoice(id, sessionId, snapshotId);
    if (!snapshot) {
      res.status(404).json({ message: "Snapshot not found" });
      return;
    }
    res.setHeader("Content-Type", snapshot.mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(snapshot.data);
  } catch (err) {
    console.error("[invoices] visit snapshot failed", err);
    res.status(500).json({ message: "Failed to load snapshot" });
  }
}

export async function getInvoiceByViewToken(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const token = String(req.params.token ?? "").trim();
    if (!token) {
      res.status(400).json({ message: "Invoice link is missing." });
      return;
    }
    const invoice = await Invoice.findOne({ viewToken: token }).lean();
    if (!invoice || invoice.status === "void") {
      res.status(404).json({ message: "This invoice link is not valid." });
      return;
    }
    recordInvoiceEventAsync({
      invoiceRef: invoice._id,
      customerRef: invoice.customerRef ?? null,
      kind: "viewed",
      actorKind: "customer",
      source: "portal",
      throttleMs: INVOICE_OPEN_THROTTLE_MS,
    });
    const enrichment = await enrichInvoiceDetail(invoice);
    const template = await ensureDefaultInvoiceTemplate();
    const parsed = invoiceBlocksSchema.safeParse(template.blocks);
    const blocks = parsed.success
      ? sanitizeInvoiceBlocks(parsed.data)
      : defaultInvoiceBlocks();
    res.json({
      invoice: hideOfflineProof({
        ...toPublicInvoice(invoice),
        ...enrichment,
      }),
      blocks,
    });
  } catch (err) {
    console.error("GET /invoice-view/:token error:", err);
    res.status(500).json({ message: "Failed to load this invoice" });
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
      const wo = await includingDeletedWorkOrders(
        WorkOrder.findById(data.workOrderRef),
      );
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
        if (
          err instanceof InvoiceAmountError ||
          err instanceof WorkOrderNotReadyError
        ) {
          res.status(400).json({ message: err.message });
          return;
        }
        throw err;
      }
    }

    const tax = await invoiceTaxFromCurrentRate(amountCents);
    amountCents = amountCents + tax.taxCents;

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
      taxRatePercent: tax.taxRatePercent,
      taxCents: tax.taxCents,
      taxOverridden: tax.taxOverridden,
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

const PROCESSED_INVOICE_STATUSES = new Set(["paid", "void"]);

export async function updateInvoiceTax(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateInvoiceTaxSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const id = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    if (PROCESSED_INVOICE_STATUSES.has(invoice.status)) {
      res.status(409).json({
        message: "Tax cannot be changed on a processed invoice",
        invoice: toPublicInvoice(invoice),
      });
      return;
    }

    const oldTaxCents = Number(invoice.taxCents) || 0;
    const currentTotal =
      typeof invoice.originalAmountCents === "number"
        ? invoice.originalAmountCents
        : invoice.amountCents;
    const preTaxCents = Math.max(currentTotal - oldTaxCents, 0);

    const taxRatePercent = normalizeTaxRatePercent(
      parsed.data.taxRatePercent ?? invoice.taxRatePercent,
    );
    const taxOverridden = parsed.data.taxCents != null;
    const taxCents = taxOverridden
      ? parsed.data.taxCents!
      : taxCentsFromDollars(computeTaxAmount(preTaxCents / 100, taxRatePercent));

    const nextTotal = preTaxCents + taxCents;
    const discountCents = Number(invoice.discountCents) || 0;
    if (typeof invoice.originalAmountCents === "number") {
      invoice.originalAmountCents = nextTotal;
      invoice.amountCents = Math.max(nextTotal - discountCents, 0);
    } else {
      invoice.amountCents = nextTotal;
    }
    invoice.taxRatePercent = taxRatePercent;
    invoice.taxCents = taxCents;
    invoice.taxOverridden = taxOverridden;
    await invoice.save();

    if (invoice.workOrderRef) {
      const workOrder = await includingDeletedWorkOrders(
        WorkOrder.findById(invoice.workOrderRef),
      );
      if (workOrder) {
        const preTax = roundMoney(
          (Number(workOrder.subtotal) || 0) + (Number(workOrder.shipping) || 0),
        );
        workOrder.taxRate = taxRatePercent;
        workOrder.tax = roundMoney(taxCents / 100);
        workOrder.taxOverridden = taxOverridden;
        workOrder.total = roundMoney(preTax + workOrder.tax);
        await workOrder.save();
      }
    }

    logNotificationAsync({
      entityType: "invoice",
      action: "updated",
      entityId: String(invoice._id),
      customerRef: invoice.customerRef ?? null,
      summary: `Invoice ${invoice.number} tax updated`,
      ...actorFromRequest(req.user),
    });

    res.json({ invoice: toPublicInvoice(invoice) });
  } catch (err) {
    console.error("[invoices] update tax failed", err);
    res.status(500).json({ message: "Failed to update invoice tax" });
  }
}

export async function markInvoicePaidByStaff(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    if (invoice.status === "paid") {
      res.status(409).json({
        message: "Invoice is already paid",
        invoice: toPublicInvoice(invoice),
      });
      return;
    }

    if (invoice.status !== "open" && invoice.status !== "failed") {
      res.status(409).json({
        message: "Invoice cannot be marked paid",
        invoice: toPublicInvoice(invoice),
      });
      return;
    }

    const updated = await markInvoicePaid({
      invoice,
      actor: actorFromRequest(req.user),
    });
    res.json({ invoice: toPublicInvoice(updated) });
  } catch {
    res.status(500).json({ message: "Failed to mark invoice paid" });
  }
}

export async function reopenInvoiceByStaff(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id ?? "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    if (invoice.status !== "paid") {
      res.status(409).json({
        message: "Invoice is not paid",
        invoice: toPublicInvoice(invoice),
      });
      return;
    }

    const updated = await reopenInvoice({
      invoice,
      actor: actorFromRequest(req.user),
    });
    res.json({ invoice: toPublicInvoice(updated) });
  } catch {
    res.status(500).json({ message: "Failed to reopen invoice" });
  }
}

export async function bulkUpdateInvoiceStatus(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = bulkInvoiceStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const ids = [...new Set(parsed.data.ids)];
    const actor = actorFromRequest(req.user);
    const updated: ReturnType<typeof toPublicInvoice>[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const failed: { id: string; message: string }[] = [];

    for (const id of ids) {
      try {
        if (!Types.ObjectId.isValid(id)) {
          skipped.push({ id, reason: "not_found" });
          continue;
        }

        const invoice = await Invoice.findById(id);
        if (!invoice) {
          skipped.push({ id, reason: "not_found" });
          continue;
        }

        if (parsed.data.paid) {
          if (invoice.status === "paid") {
            skipped.push({ id, reason: "already_paid" });
            continue;
          }
          if (invoice.status !== "open" && invoice.status !== "failed") {
            skipped.push({ id, reason: "cannot_mark_paid" });
            continue;
          }
          const next = await markInvoicePaid({ invoice, actor });
          updated.push(toPublicInvoice(next));
        } else {
          if (invoice.status !== "paid") {
            skipped.push({ id, reason: "not_paid" });
            continue;
          }
          const next = await reopenInvoice({ invoice, actor });
          updated.push(toPublicInvoice(next));
        }
      } catch (err) {
        failed.push({
          id,
          message:
            err instanceof Error ? err.message : "Failed to update invoice",
        });
      }
    }

    res.json({ updated, skipped, failed });
  } catch (err) {
    console.error("[invoices] bulk status failed", err);
    res.status(500).json({ message: "Failed to update invoices" });
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

    if (!isStaff(req.user) && req.user?.id) {
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
    const staffStarted = isStaff(req.user);
    recordInvoiceEventAsync({
      invoiceRef: invoice._id,
      customerRef: invoice.customerRef ?? null,
      kind: "checkout_started",
      actorKind: staffStarted ? "staff" : "customer",
      actorUserId: staffStarted ? req.user?.id ?? null : null,
      source: staffStarted ? "crm" : "portal",
      throttleMs: 2 * 60 * 1000,
    });

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

export async function startInvoicePosCharge(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

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
    if (!invoice.amountCents || invoice.amountCents <= 0) {
      res.status(400).json({ message: "Amount must be greater than zero" });
      return;
    }

    const { adapter, account } = await resolveCheckoutProviderForInvoice(
      invoice.customerRef,
    );
    if (adapter.name !== "square") {
      res.status(400).json({ message: "Tap to Pay requires Square" });
      return;
    }
    if (!account.account.locationId) {
      res.status(400).json({ message: "Square location ID is not configured" });
      return;
    }
    if (account.account.environment !== "production") {
      res.status(400).json({
        message:
          "Tap to Pay needs a production Square account; Square does not support sandbox for Point of Sale.",
      });
      return;
    }

    const applicationId =
      account.account.applicationId?.trim() ||
      (await squarePosApplicationId("production"));
    if (!applicationId) {
      res.status(400).json({
        message:
          "Square application ID is not configured. Add it in Admin Panel → Payment platforms.",
      });
      return;
    }

    const note = paymentNoteForInvoiceIds([String(invoice._id)]);
    invoice.paymentProvider = "square";
    invoice.paymentProviderAccountRef = account.account._id as Types.ObjectId;
    invoice.status = "open";
    invoice.posCharge = {
      startedAt: new Date(),
      accountRef: account.account._id as Types.ObjectId,
      locationId: account.account.locationId,
      amountCents: invoice.amountCents,
      transactionId: null,
      status: "pending",
      lastCheckedAt: null,
      reviewReason: null,
    };
    invoice.markModified("posCharge");
    await invoice.save();

    res.json({
      amountCents: invoice.amountCents,
      currency: invoice.currency || "USD",
      applicationId,
      locationId: account.account.locationId,
      callbackUrl: buildPosCallbackUrl(),
      state: signPosChargeState({
        invoiceId: String(invoice._id),
        amountCents: invoice.amountCents,
      }),
      note,
    });
  } catch (err) {
    console.error("[invoices] pos charge failed", err);
    res.status(500).json({
      message:
        err instanceof Error ? err.message : "Failed to start Tap to Pay",
    });
  }
}

export async function confirmInvoicePosCharge(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    const body = (req.body ?? {}) as {
      transactionId?: unknown;
      state?: unknown;
      error?: unknown;
    };
    const transactionId = String(body.transactionId ?? "").trim();
    const state = String(body.state ?? "").trim();
    const squareError = String(body.error ?? "").trim();
    if (squareError) {
      if (invoice.status !== "paid" && isValidPosState(state, invoice)) {
        const canceled = squareError === "payment_canceled";
        recordInvoiceEventAsync({
          invoiceRef: invoice._id as Types.ObjectId,
          customerRef: invoice.customerRef ?? null,
          kind: canceled ? "payment_canceled" : "payment_failed",
          method: "tap_to_pay",
          provider: "square",
          amountCents: invoice.posCharge?.amountCents ?? invoice.amountCents,
          reason: canceled
            ? "Canceled in Square Point of Sale. No charge was made."
            : `Square Point of Sale returned ${squareError.slice(0, 200)}`,
          actorKind: "staff",
          actorUserId: req.user?.id ?? null,
          source: "crm",
          throttleMs: 10 * 1000,
        });
      }
      if (
        squareError === "payment_canceled" &&
        invoice.posCharge?.status === "pending" &&
        !invoice.posCharge.transactionId &&
        isValidPosState(state, invoice)
      ) {
        invoice.posCharge.status = "failed";
        invoice.posCharge.lastCheckedAt = new Date();
        invoice.markModified("posCharge");
        await invoice.save();
      }
      res.status(400).json({
        message:
          squareError === "payment_canceled"
            ? "Payment canceled. No charge was made."
            : "Tap to Pay could not be completed.",
      });
      return;
    }

    try {
      verifyPosChargeState(state, {
        invoiceId: String(invoice._id),
        amountCents: invoice.amountCents,
        allowExpired: true,
      });
    } catch (err) {
      if (err instanceof PosChargeError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      throw err;
    }

    if (invoice.status === "paid") {
      const sameCharge =
        Boolean(transactionId) &&
        (invoice.providerOrderId === transactionId ||
          invoice.providerPaymentId === transactionId);
      if (sameCharge) {
        res.json({ status: "paid", invoice: toPublicInvoice(invoice) });
        return;
      }
      res.status(409).json({
        message: "Invoice is already paid",
        invoice: toPublicInvoice(invoice),
      });
      return;
    }
    if (invoice.status === "void") {
      res.status(400).json({ message: "Invoice is void" });
      return;
    }
    if (!transactionId) {
      res.status(400).json({ message: "Missing Square transaction" });
      return;
    }

    if (invoice.posCharge && invoice.posCharge.transactionId !== transactionId) {
      invoice.posCharge.transactionId = transactionId;
      invoice.markModified("posCharge");
      await invoice.save();
    }

    const square = await resolvePosSquareAccount(invoice);
    if (!square) {
      res.status(400).json({ message: "Tap to Pay requires Square" });
      return;
    }

    const check = await checkPosTransaction({
      invoice,
      adapter: square.adapter,
      account: square.account,
      transactionId,
    });
    if (check.status === "unavailable") {
      res.status(502).json({ message: check.message });
      return;
    }
    if (check.status === "pending") {
      res.json({ status: "pending", invoice: toPublicInvoice(invoice) });
      return;
    }
    if (check.status === "failed") {
      recordInvoiceEventAsync({
        invoiceRef: invoice._id as Types.ObjectId,
        customerRef: invoice.customerRef ?? null,
        kind: "payment_failed",
        method: "tap_to_pay",
        provider: "square",
        amountCents: invoice.posCharge?.amountCents ?? invoice.amountCents,
        reason: "Square reported the Tap to Pay charge failed or was canceled",
        providerPaymentId: transactionId,
        actorKind: "staff",
        actorUserId: req.user?.id ?? null,
        source: "crm",
        sourceEventId: paymentSourceEventId(invoice._id as Types.ObjectId, "square", transactionId, "failed"),
      });
      res.json({ status: "failed", invoice: toPublicInvoice(invoice) });
      return;
    }
    if (check.status === "mismatch") {
      await flagPosChargeForReview(invoice, check.message);
      res.status(400).json({ message: check.message });
      return;
    }

    const [updated] = await settleInvoicePayment({
      invoices: [invoice],
      providerPaymentId: check.payment.providerPaymentId,
      providerOrderId: check.payment.providerOrderId,
      actor: actorFromRequest(req.user),
      method: "tap_to_pay",
      apiBase: resolvePublicApiBase(req),
    });
    res.json({ status: "paid", invoice: toPublicInvoice(updated ?? invoice) });
  } catch (err) {
    console.error("[invoices] pos confirm failed", err);
    res.status(500).json({
      message:
        err instanceof Error ? err.message : "Failed to confirm Tap to Pay",
    });
  }
}

function isValidPosState(state: string, invoice: IInvoice): boolean {
  try {
    verifyPosChargeState(state, {
      invoiceId: String(invoice._id),
      amountCents: invoice.amountCents,
      allowExpired: true,
    });
    return true;
  } catch {
    return false;
  }
}

const POS_RECONCILE_MESSAGES: Record<string, string> = {
  paid: "Square payment found. The invoice is marked paid.",
  pending: "Square is still processing this payment. Check again in a moment.",
  failed: "Square shows this Tap to Pay charge did not complete.",
  not_found: "No matching Square payment was found yet.",
};

export async function reconcileInvoicePosCharge(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isStaff(req.user)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    if (invoice.status !== "paid" && invoice.posCharge?.status === "needs_review") {
      invoice.posCharge.status = "pending";
      invoice.markModified("posCharge");
    }
    const outcome = await reconcilePosCharge(invoice, {
      actor: actorFromRequest(req.user),
      apiBase: resolvePublicApiBase(req),
    });
    const fresh = (await Invoice.findById(invoice._id)) ?? invoice;
    const message =
      outcome.status === "needs_review"
        ? outcome.reason
        : outcome.status === "skipped"
          ? outcome.reason
          : POS_RECONCILE_MESSAGES[outcome.status] ?? "Checked Square.";
    res.json({ status: outcome.status, message, invoice: toPublicInvoice(fresh) });
  } catch (err) {
    console.error("[invoices] pos reconcile failed", err);
    res.status(500).json({
      message: err instanceof Error ? err.message : "Failed to check Square",
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

    const link = await createScopedPaymentLink(String(invoice.customerRef), {
      invoiceId: String(invoice._id),
      expectedAmountCents: invoice.amountCents,
    });
    if (!link) throw new Error("Invoice is not payable");
    res.json({
      payUrl: link.payUrl,
      invoice: toPublicInvoice(invoice),
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      res.status(err.statusCode).json({ message: err.message });
      return;
    }
    console.error("[invoices] create pay link failed", err);
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

    const payable = invoices.filter(
      (invoice) => invoice.status !== "paid" && invoice.status !== "void",
    );
    if (
      payable.length === 0 &&
      invoices.some(
        (invoice) =>
          invoice.status === "void" &&
          invoice.metadata?.voidReason === WORK_ORDER_REOPENED_REASON,
      )
    ) {
      res.status(409).json({
        message:
          "This invoice is no longer payable because the work order was reopened.",
      });
      return;
    }

    for (const invoice of invoices) {
      recordInvoiceEventAsync({
        invoiceRef: invoice._id,
        customerRef: invoice.customerRef ?? null,
        kind: "pay_link_opened",
        actorKind: "customer",
        source: "portal",
        throttleMs: INVOICE_OPEN_THROTTLE_MS,
      });
    }

    const publicInvoices = await Promise.all(
      invoices.map(async (invoice) => {
        const workOrderNotes = invoice.workOrderRef
          ? await listVisibleWorkOrderNotes(invoice.workOrderRef)
          : [];
        return hideOfflineProof({ ...toPublicInvoice(invoice), workOrderNotes });
      }),
    );
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
      const reopened = invoices.some(
        (invoice) =>
          invoice.status === "void" &&
          invoice.metadata?.voidReason === WORK_ORDER_REOPENED_REASON,
      );
      res.status(reopened ? 409 : 400).json({
        message: reopened
          ? "This invoice is no longer payable because the work order was reopened."
          : "Invoice is already paid",
      });
      return;
    }

    for (const invoice of unpaid) {
      recordInvoiceEventAsync({
        invoiceRef: invoice._id,
        customerRef: invoice.customerRef ?? null,
        kind: "checkout_started",
        actorKind: "customer",
        source: "portal",
        throttleMs: 2 * 60 * 1000,
      });
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
