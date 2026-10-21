import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Estimate } from "../models/mongo/Estimate";
import { Customer } from "../models/mongo/Customer";
import { dollarsToCents } from "../services/invoice.service";
import { completedPaidWorkOrderFilter } from "../services/completedPaidReport";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function customerDisplayName(customer: {
  accountName?: string;
  first?: string;
  last?: string;
  legacyId?: number;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  const full = `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
  if (full) return full;
  return customer.legacyId ? `Customer #${customer.legacyId}` : "Unnamed Customer";
}

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

    const [invoices, workOrders, estimates, completedPaidOrders] = await Promise.all([
      Invoice.find(invoiceMatch)
        .select("status amountCents dueDate issuedAt paidAt workOrderRef sourceType")
        .lean(),
      WorkOrder.find(woMatch)
        .select("total paid completed laborHours date createdAt")
        .lean(),
      Estimate.find(estimateMatch)
        .select("status total createdAt")
        .lean(),
      WorkOrder.find(completedPaidWorkOrderFilter(from, to))
        .select("total")
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

    let completedPaidCents = 0;
    for (const wo of completedPaidOrders) {
      completedPaidCents += dollarsToCents(wo.total || 0);
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
        completedPaidCount: completedPaidOrders.length,
        completedPaidCents,
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

export async function getFinancialsRecords(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const from = parseBound(req.query.from);
    const to = parseBound(req.query.to);
    const type = String(req.query.type || "invoiced");
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.pageSize || "25"), 10) || 25),
    );
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const sortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy.trim() : "";
    const sortDir: 1 | -1 = req.query.sortDir === "asc" ? 1 : -1;
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    // Group 1: Invoices
    if (
      type === "invoiced" ||
      type === "paid" ||
      type === "outstanding" ||
      type === "past_due"
    ) {
      const match: Record<string, unknown> = {};
      inRange(match, "issuedAt", from, to);

      if (type === "paid") {
        match.status = "paid";
      } else if (type === "outstanding") {
        match.status = { $in: ["open", "draft"] };
      } else if (type === "past_due") {
        match.status = { $in: ["open", "draft"] };
        match.dueDate = { $lt: startOfToday };
      }

      if (search) {
        const re = new RegExp(escapeRegex(search), "i");
        const matchingCustomers = await Customer.find({
          $or: [
            { accountName: re },
            { first: re },
            { last: re },
          ],
        })
          .select("_id legacyId")
          .lean();

        const custRefs = matchingCustomers.map((c) => c._id);
        const custLegacyIds = matchingCustomers
          .map((c) => c.legacyId)
          .filter((id): id is number => typeof id === "number");

        const orConditions: Record<string, unknown>[] = [{ number: re }];
        if (custRefs.length > 0) {
          orConditions.push({ customerRef: { $in: custRefs } });
        }
        if (custLegacyIds.length > 0) {
          orConditions.push({ customerId: { $in: custLegacyIds } });
        }
        match.$or = orConditions;
      }

      let sort: Record<string, 1 | -1>;
      if (sortBy === "number") {
        sort = { number: sortDir };
      } else if (sortBy === "date") {
        sort =
          type === "paid"
            ? { paidAt: sortDir, issuedAt: sortDir, createdAt: sortDir }
            : { issuedAt: sortDir, createdAt: sortDir };
      } else if (sortBy === "dueDate") {
        sort = { dueDate: sortDir, issuedAt: -1 };
      } else if (sortBy === "total" || sortBy === "amount") {
        sort = { amountCents: sortDir };
      } else if (sortBy === "status") {
        sort = { status: sortDir };
      } else {
        sort =
          type === "paid"
            ? { paidAt: -1, issuedAt: -1, createdAt: -1 }
            : type === "past_due"
              ? { dueDate: 1, issuedAt: -1 }
              : { issuedAt: -1, createdAt: -1 };
      }

      const [total, invoices] = await Promise.all([
        Invoice.countDocuments(match),
        Invoice.find(match)
          .sort(sort)
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
      ]);

      const customerRefs = invoices
        .map((inv) => inv.customerRef?.toString())
        .filter(Boolean) as string[];
      const customerLegacyIds = invoices
        .map((inv) => inv.customerId)
        .filter((id): id is number => typeof id === "number");

      const [byRef, byLegacy] = await Promise.all([
        customerRefs.length > 0
          ? Customer.find({
              _id: { $in: customerRefs.map((id) => new Types.ObjectId(id)) },
            })
              .select("_id accountName first last legacyId")
              .lean()
          : [],
        customerLegacyIds.length > 0
          ? Customer.find({
              legacyId: { $in: customerLegacyIds },
              deletedAt: null,
              $or: [
                { mergedIntoRef: null },
                { mergedIntoRef: { $exists: false } },
              ],
            })
              .select("legacyId accountName first last _id")
              .lean()
          : [],
      ]);

      const nameMap = new Map<string, string>();
      for (const c of byRef) {
        const name = customerDisplayName(c);
        nameMap.set(String(c._id), name);
        if (typeof c.legacyId === "number") {
          nameMap.set(`legacy:${c.legacyId}`, name);
        }
      }
      for (const c of byLegacy) {
        const name = customerDisplayName(c);
        nameMap.set(String(c._id), name);
        if (typeof c.legacyId === "number") {
          nameMap.set(`legacy:${c.legacyId}`, name);
        }
      }

      const records = invoices.map((inv) => {
        let customerName = "";
        if (inv.customerRef && nameMap.has(String(inv.customerRef))) {
          customerName = nameMap.get(String(inv.customerRef))!;
        } else if (
          typeof inv.customerId === "number" &&
          nameMap.has(`legacy:${inv.customerId}`)
        ) {
          customerName = nameMap.get(`legacy:${inv.customerId}`)!;
        } else if (inv.customerId) {
          customerName = `Customer #${inv.customerId}`;
        }

        return {
          _id: String(inv._id),
          recordType: "invoice" as const,
          number: inv.number,
          customerName,
          date: inv.issuedAt
            ? new Date(inv.issuedAt).toISOString()
            : new Date(inv.createdAt).toISOString(),
          dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString() : null,
          paidAt: inv.paidAt ? new Date(inv.paidAt).toISOString() : null,
          status: inv.status,
          amountCents: inv.amountCents || 0,
          total: (inv.amountCents || 0) / 100,
          sourceType: inv.sourceType,
          detailUrl: `/dashboard/orders/detail?id=${inv._id}`,
        };
      });

      if (sortBy === "customerName") {
        records.sort(
          (a, b) => a.customerName.localeCompare(b.customerName) * sortDir,
        );
      }

      res.json({
        type,
        records,
        total,
        page,
        pageSize,
      });
      return;
    }

    // Group 2: Work Orders
    if (
      type === "open_work_orders" ||
      type === "unbilled_work" ||
      type === "labor_hours" ||
      type === "completed_paid"
    ) {
      const match: Record<string, unknown> =
        type === "completed_paid"
          ? completedPaidWorkOrderFilter(from, to)
          : {};
      if (type !== "completed_paid" && (from || to)) {
        const range: Record<string, Date> = {};
        if (from) range.$gte = from;
        if (to) range.$lte = to;
        match.$or = [{ date: range }, { createdAt: range }];
      }

      if (type === "open_work_orders") {
        match.completed = false;
      } else if (type === "unbilled_work") {
        match.paid = false;
        match.total = { $gt: 0 };
      } else if (type === "labor_hours") {
        match.laborHours = { $gt: 0 };
      }

      if (search) {
        const re = new RegExp(escapeRegex(search), "i");
        const orConditions: Record<string, unknown>[] = [
          { number: re },
          { customerName: re },
          { descPerform: re },
        ];
        const num = parseInt(search, 10);
        if (!Number.isNaN(num)) {
          orConditions.push({ legacyId: num });
        }
        if (match.$or) {
          match.$and = [{ $or: match.$or }, { $or: orConditions }];
          delete match.$or;
        } else {
          match.$or = orConditions;
        }
      }

      let sort: Record<string, 1 | -1>;
      if (sortBy === "number") {
        sort = { legacyId: sortDir, number: sortDir };
      } else if (sortBy === "customerName") {
        sort = { customerName: sortDir };
      } else if (sortBy === "date") {
        sort = { date: sortDir, createdAt: sortDir };
      } else if (sortBy === "laborHours") {
        sort = { laborHours: sortDir, date: -1 };
      } else if (sortBy === "paid") {
        sort = { paid: sortDir, date: -1 };
      } else if (sortBy === "total" || sortBy === "amount") {
        sort = { total: sortDir, date: -1 };
      } else if (sortBy === "status") {
        sort = { completed: sortDir, date: -1 };
      } else {
        sort =
          type === "labor_hours"
            ? { laborHours: -1, date: -1, createdAt: -1 }
            : type === "unbilled_work"
              ? { total: -1, date: -1, createdAt: -1 }
              : type === "completed_paid"
                ? { date: 1 }
                : { date: -1, createdAt: -1 };
      }

      const [total, workOrders] = await Promise.all([
        WorkOrder.countDocuments(match),
        WorkOrder.find(match)
          .sort(sort)
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
      ]);

      const missingCustLegacy = workOrders
        .filter((wo) => !wo.customerName && typeof wo.customerId === "number")
        .map((wo) => wo.customerId);
      const missingCustRef = workOrders
        .filter((wo) => !wo.customerName && wo.customerRef)
        .map((wo) => wo.customerRef!.toString());

      const [byRef, byLegacy] = await Promise.all([
        missingCustRef.length > 0
          ? Customer.find({
              _id: { $in: missingCustRef.map((id) => new Types.ObjectId(id)) },
            })
              .select("_id accountName first last legacyId")
              .lean()
          : [],
        missingCustLegacy.length > 0
          ? Customer.find({
              legacyId: { $in: missingCustLegacy },
              deletedAt: null,
            })
              .select("legacyId accountName first last")
              .lean()
          : [],
      ]);

      const nameMap = new Map<string, string>();
      for (const c of byRef) nameMap.set(String(c._id), customerDisplayName(c));
      for (const c of byLegacy) {
        if (typeof c.legacyId === "number") {
          nameMap.set(`legacy:${c.legacyId}`, customerDisplayName(c));
        }
      }

      const records = workOrders.map((wo) => {
        let customerName = wo.customerName || "";
        if (!customerName) {
          if (wo.customerRef && nameMap.has(String(wo.customerRef))) {
            customerName = nameMap.get(String(wo.customerRef))!;
          } else if (
            typeof wo.customerId === "number" &&
            nameMap.has(`legacy:${wo.customerId}`)
          ) {
            customerName = nameMap.get(`legacy:${wo.customerId}`)!;
          } else if (wo.customerId) {
            customerName = `Customer #${wo.customerId}`;
          }
        }

        const dateVal =
          type === "completed_paid" ? wo.date : wo.date || wo.createdAt;
        return {
          _id: String(wo._id),
          recordType: "work_order" as const,
          number:
            wo.number ||
            (wo.legacyId ? `WO #${wo.legacyId}` : String(wo._id).slice(-6)),
          customerName,
          date: dateVal ? new Date(dateVal).toISOString() : "",
          status: wo.completed ? "completed" : "open",
          paid: Boolean(wo.paid),
          laborHours: wo.laborHours || 0,
          total: wo.total || 0,
          amountCents: dollarsToCents(wo.total || 0),
          description: wo.descPerform || "",
          detailUrl: `/dashboard/work-orders/detail?id=${wo._id}`,
        };
      });

      res.json({
        type,
        records,
        total,
        page,
        pageSize,
      });
      return;
    }

    // Group 3: Estimates
    if (type === "estimates") {
      const match: Record<string, unknown> = {};
      inRange(match, "createdAt", from, to);

      if (search) {
        const re = new RegExp(escapeRegex(search), "i");
        match.$or = [
          { number: re },
          { customerName: re },
          { descPerform: re },
        ];
      }

      let sort: Record<string, 1 | -1>;
      if (sortBy === "number") {
        sort = { number: sortDir };
      } else if (sortBy === "customerName") {
        sort = { customerName: sortDir };
      } else if (sortBy === "date") {
        sort = { createdAt: sortDir };
      } else if (sortBy === "total" || sortBy === "amount") {
        sort = { total: sortDir };
      } else if (sortBy === "status") {
        sort = { status: sortDir };
      } else if (sortBy === "laborHours") {
        sort = { laborHours: sortDir };
      } else {
        sort = { createdAt: -1 };
      }

      const [total, estimates] = await Promise.all([
        Estimate.countDocuments(match),
        Estimate.find(match)
          .sort(sort)
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
      ]);

      const records = estimates.map((est) => ({
        _id: String(est._id),
        recordType: "estimate" as const,
        number: est.number || String(est._id).slice(-6),
        customerName:
          est.customerName ||
          (est.customerId ? `Customer #${est.customerId}` : ""),
        date: est.createdAt ? new Date(est.createdAt).toISOString() : "",
        status: est.status,
        laborHours: est.laborHours || 0,
        total: est.total || 0,
        amountCents: dollarsToCents(est.total || 0),
        description: est.descPerform || "",
        detailUrl: `/dashboard/estimates/detail?id=${est._id}`,
      }));

      res.json({
        type,
        records,
        total,
        page,
        pageSize,
      });
      return;
    }

    res.status(400).json({ message: `Unknown financial filter type: ${type}` });
  } catch (err) {
    console.error("GET /financials/records error:", err);
    res.status(500).json({ message: "Failed to load financials records" });
  }
}

