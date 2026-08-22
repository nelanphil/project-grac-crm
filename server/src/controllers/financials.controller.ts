import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Estimate } from "../models/mongo/Estimate";
import { dollarsToCents } from "../services/invoice.service";

function parseBound(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(filter: Record<string, unknown>, field: string, from: Date | null, to: Date | null) {
  if (!from && !to) return;
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  filter[field] = range;
}

export async function getFinancialsSummary(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const from = parseBound(req.query.from);
    const to = parseBound(req.query.to);
    const now = new Date();

    const invoiceMatch: Record<string, unknown> = {};
    inRange(invoiceMatch, "issuedAt", from, to);

    const woMatch: Record<string, unknown> = {};
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      woMatch.$or = [{ date: range }, { createdAt: range }];
    }

    const estimateMatch: Record<string, unknown> = {};
    inRange(estimateMatch, "createdAt", from, to);

    const [invoices, workOrders, estimates] = await Promise.all([
      Invoice.find(invoiceMatch)
        .select("status amountCents dueDate issuedAt paidAt workOrderRef sourceType")
        .lean(),
      WorkOrder.find(woMatch)
        .select("total paid completed laborHours date createdAt")
        .lean(),
      Estimate.find(estimateMatch)
        .select("status total createdAt")
        .lean(),
    ]);

    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    let invoicedCents = 0;
    let paidCents = 0;
    let outstandingCents = 0;
    let pastDueCents = 0;
    let openInvoiceCount = 0;
    let paidInvoiceCount = 0;

    for (const invoice of invoices) {
      invoicedCents += invoice.amountCents || 0;
      if (invoice.status === "paid") {
        paidCents += invoice.amountCents || 0;
        paidInvoiceCount += 1;
      } else if (invoice.status === "open" || invoice.status === "draft") {
        outstandingCents += invoice.amountCents || 0;
        openInvoiceCount += 1;
        if (invoice.dueDate && new Date(invoice.dueDate) < startOfToday) {
          pastDueCents += invoice.amountCents || 0;
        }
      }
    }

    let openWorkOrders = 0;
    let completedWorkOrders = 0;
    let unbilledCents = 0;
    let laborHours = 0;

    for (const wo of workOrders) {
      if (wo.completed) completedWorkOrders += 1;
      else openWorkOrders += 1;
      laborHours += wo.laborHours || 0;
      if (!wo.paid && (wo.total || 0) > 0) {
        unbilledCents += dollarsToCents(wo.total || 0);
      }
    }

    const estimateByStatus: Record<string, { count: number; cents: number }> = {
      draft: { count: 0, cents: 0 },
      sent: { count: 0, cents: 0 },
      accepted: { count: 0, cents: 0 },
      declined: { count: 0, cents: 0 },
      converted: { count: 0, cents: 0 },
    };
    for (const estimate of estimates) {
      const key = estimate.status in estimateByStatus ? estimate.status : "draft";
      estimateByStatus[key].count += 1;
      estimateByStatus[key].cents += dollarsToCents(estimate.total || 0);
    }

    res.json({
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      invoices: {
        count: invoices.length,
        invoicedCents,
        paidCents,
        outstandingCents,
        pastDueCents,
        openCount: openInvoiceCount,
        paidCount: paidInvoiceCount,
      },
      workOrders: {
        count: workOrders.length,
        openCount: openWorkOrders,
        completedCount: completedWorkOrders,
        unbilledCents,
        laborHours,
      },
      estimates: {
        count: estimates.length,
        byStatus: estimateByStatus,
      },
    });
  } catch (err) {
    console.error("GET /financials/summary error:", err);
    res.status(500).json({ message: "Failed to load financials summary" });
  }
}
