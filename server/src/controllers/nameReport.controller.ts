import { Response } from "express";
import mongoose, { type PipelineStage } from "mongoose";
import { getMongoStatus } from "../config/mongodb";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  activeCustomerFilter,
  Customer,
  isCustomerReputation,
  notMergedFilter,
  type CustomerReputation,
} from "../models/mongo/Customer";
import {
  activeContactFilter,
  CustomerContact,
} from "../models/mongo/CustomerContact";
import {
  updateContactNameReportSchema,
  updateCustomerNameReportSchema,
} from "../schemas/nameReport.schema";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import { diffFields } from "../services/customerActivity.service";
import { syncCustomerPrimaryContactFields } from "../utils/customerContacts";
import {
  DUPLICATE_ACCOUNT_NAME,
  findAccountNameMatches,
} from "../utils/customerDuplicates";
import { buildTokenSearchFilter } from "../utils/textSearch";

const PAGE_SIZES = [50, 150, 250, 500];

type CustomerNameRow = {
  id: string;
  accountName: string;
  first: string;
  last: string;
  reputation: CustomerReputation | null;
};

type ContactNameRow = {
  id: string;
  first: string;
  last: string;
  isPrimary: boolean;
  customerId: string;
  customerName: string;
};

function parsePage(value: unknown): number {
  const page = parseInt(String(value ?? "1"), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function parsePageSize(value: unknown): number {
  const pageSize = parseInt(String(value ?? "50"), 10);
  return PAGE_SIZES.includes(pageSize) ? pageSize : 50;
}

function parentCustomerName(
  accountName: string | null | undefined,
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const account = (accountName ?? "").trim();
  if (account) return account;
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name || "Customer";
}

function customerRow(customer: {
  _id: mongoose.Types.ObjectId;
  accountName?: string | null;
  first?: string | null;
  last?: string | null;
  reputation?: string | null;
}): CustomerNameRow {
  return {
    id: customer._id.toString(),
    accountName: customer.accountName ?? "",
    first: customer.first ?? "",
    last: customer.last ?? "",
    reputation: isCustomerReputation(customer.reputation)
      ? customer.reputation
      : null,
  };
}

function reputationQuery(value: string): Record<string, unknown> | null {
  const raw = value.trim();
  if (!raw || raw === "all") return null;
  if (raw === "unrated") return { reputation: null };
  if (isCustomerReputation(raw)) return { reputation: raw };
  return null;
}

function activeCustomerQuery(
  search: string,
  reputation: string,
): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [
    {
      ...activeCustomerFilter,
      ...notMergedFilter,
    },
  ];
  const tokens = buildTokenSearchFilter(search, [
    "accountName",
    "first",
    "last",
  ]);
  if (tokens) parts.push(tokens);
  const reputationMatch = reputationQuery(reputation);
  if (reputationMatch) parts.push(reputationMatch);
  return parts.length === 1 ? parts[0] : { $and: parts };
}

export async function listCustomerNames(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: "Database unavailable. Please try again later." });
    return;
  }

  try {
    const pageSize = parsePageSize(req.query.pageSize);
    const requestedPage = parsePage(req.query.page);
    const filter = activeCustomerQuery(
      String(req.query.q ?? ""),
      String(req.query.reputation ?? ""),
    );
    const total = await Customer.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const page = Math.min(requestedPage, totalPages);
    const customers = await Customer.find(filter)
      .sort({ last: 1, first: 1, accountName: 1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select("accountName first last reputation")
      .lean();

    res.json({
      rows: customers.map((customer) =>
        customerRow({
          _id: customer._id as mongoose.Types.ObjectId,
          accountName: customer.accountName,
          first: customer.first,
          last: customer.last,
          reputation: customer.reputation,
        }),
      ),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /name-reports/customers error:", err);
    res.status(500).json({ message: "Failed to load customer names." });
  }
}

export async function updateCustomerName(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: "Database unavailable. Please try again later." });
    return;
  }

  const id = String(req.params.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ message: "Customer not found" });
    return;
  }

  const parsed = updateCustomerNameReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    });
    return;
  }

  try {
    const customer = await Customer.findOne({
      _id: id,
      ...activeCustomerFilter,
      ...notMergedFilter,
    }).select("accountName first last reputation");
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const nextFirst =
      parsed.data.first !== undefined ? parsed.data.first : (customer.first ?? "");
    const nextLast =
      parsed.data.last !== undefined ? parsed.data.last : (customer.last ?? "");
    let nextAccount = customer.accountName ?? "";
    if (parsed.data.accountName !== undefined) {
      nextAccount =
        parsed.data.accountName || `${nextFirst} ${nextLast}`.trim();
      const matches = await findAccountNameMatches(nextAccount, id);
      if (matches.length > 0) {
        res.status(409).json({ message: DUPLICATE_ACCOUNT_NAME });
        return;
      }
    }

    let contact: {
      id: string;
      first: string;
      last: string;
      isPrimary: boolean;
    } | null = null;
    const customerSet: Record<string, unknown> = {};
    const previousReputation = isCustomerReputation(customer.reputation)
      ? customer.reputation
      : null;
    const reputationChanged =
      parsed.data.reputation !== undefined &&
      previousReputation !== parsed.data.reputation;

    if (parsed.data.first !== undefined || parsed.data.last !== undefined) {
      const primary = await CustomerContact.findOne({
        customerRef: customer._id,
        isPrimary: true,
        ...activeContactFilter,
      });
      if (primary) {
        if (parsed.data.first !== undefined) primary.first = nextFirst;
        if (parsed.data.last !== undefined) primary.last = nextLast;
        await primary.save();
        await syncCustomerPrimaryContactFields(customer._id);
        contact = {
          id: primary._id.toString(),
          first: primary.first ?? "",
          last: primary.last ?? "",
          isPrimary: true,
        };
      } else {
        customerSet.first = nextFirst;
        customerSet.last = nextLast;
      }
    }

    if (parsed.data.accountName !== undefined) {
      customerSet.accountName = nextAccount;
    }
    if (reputationChanged && parsed.data.reputation !== undefined) {
      customerSet.reputation = parsed.data.reputation;
    }
    if (Object.keys(customerSet).length > 0) {
      await Customer.updateOne({ _id: customer._id }, { $set: customerSet });
    }

    if (reputationChanged) {
      const custName = customerDisplayName({
        accountName: nextAccount,
        first: nextFirst,
        last: nextLast,
      });
      logNotificationAsync({
        entityType: "customer",
        action: "updated",
        entityId: String(customer._id),
        customerRef: customer._id,
        summary: `Customer ${custName} reputation updated`,
        metadata: {
          customerName: custName,
          accountName: nextAccount,
          changes: diffFields(
            { reputation: previousReputation },
            { reputation: parsed.data.reputation ?? null },
            ["reputation"],
          ),
        },
        ...actorFromRequest(req.user),
      });
    }

    const refreshed = await Customer.findById(customer._id)
      .select("accountName first last reputation")
      .lean();
    if (!refreshed) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    res.json({
      row: customerRow({
        _id: refreshed._id as mongoose.Types.ObjectId,
        accountName: refreshed.accountName,
        first: refreshed.first,
        last: refreshed.last,
        reputation: refreshed.reputation,
      }),
      contact,
    });
  } catch (err) {
    console.error("PATCH /name-reports/customers/:id error:", err);
    res.status(500).json({ message: "Failed to update customer name." });
  }
}

export async function listContactNames(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: "Database unavailable. Please try again later." });
    return;
  }

  try {
    const pageSize = parsePageSize(req.query.pageSize);
    const requestedPage = parsePage(req.query.page);
    const search = buildTokenSearchFilter(String(req.query.q ?? ""), [
      "first",
      "last",
      "customer.accountName",
      "customer.first",
      "customer.last",
    ]);

    const pipeline: mongoose.PipelineStage[] = [
      { $match: { ...activeContactFilter } },
      {
        $lookup: {
          from: Customer.collection.name,
          localField: "customerRef",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: "$customer" },
      {
        $match: {
          "customer.deletedAt": null,
          "customer.mergedIntoRef": null,
        },
      },
    ];
    if (search) pipeline.push({ $match: search });

    const counted = await CustomerContact.aggregate<{ total: number }>([
      ...pipeline,
      { $count: "total" },
    ]);
    const total = counted[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const page = Math.min(requestedPage, totalPages);

    const docs = await CustomerContact.aggregate<{
      _id: mongoose.Types.ObjectId;
      first?: string;
      last?: string;
      isPrimary?: boolean;
      customerRef: mongoose.Types.ObjectId;
      customer?: {
        accountName?: string;
        first?: string;
        last?: string;
      };
    }>([
      ...pipeline,
      { $sort: { last: 1, first: 1, _id: 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
    ]);

    const rows: ContactNameRow[] = docs.map((doc) => ({
      id: doc._id.toString(),
      first: doc.first ?? "",
      last: doc.last ?? "",
      isPrimary: doc.isPrimary === true,
      customerId: doc.customerRef.toString(),
      customerName: parentCustomerName(
        doc.customer?.accountName,
        doc.customer?.first,
        doc.customer?.last,
      ),
    }));

    res.json({ rows, total, page, pageSize });
  } catch (err) {
    console.error("GET /name-reports/contacts error:", err);
    res.status(500).json({ message: "Failed to load contact names." });
  }
}

export async function updateContactName(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: "Database unavailable. Please try again later." });
    return;
  }

  const id = String(req.params.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ message: "Contact not found" });
    return;
  }

  const parsed = updateContactNameReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    });
    return;
  }

  try {
    const contact = await CustomerContact.findOne({
      _id: id,
      ...activeContactFilter,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    const customer = await Customer.findOne({
      _id: contact.customerRef,
      ...activeCustomerFilter,
      ...notMergedFilter,
    }).select("accountName first last reputation");
    if (!customer) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    if (parsed.data.first !== undefined) contact.first = parsed.data.first;
    if (parsed.data.last !== undefined) contact.last = parsed.data.last;
    await contact.save();

    if (contact.isPrimary) {
      await syncCustomerPrimaryContactFields(customer._id);
    }

    const refreshedCustomer = await Customer.findById(customer._id)
      .select("accountName first last reputation")
      .lean();

    const row: ContactNameRow = {
      id: contact._id.toString(),
      first: contact.first ?? "",
      last: contact.last ?? "",
      isPrimary: contact.isPrimary === true,
      customerId: customer._id.toString(),
      customerName: parentCustomerName(
        refreshedCustomer?.accountName ?? customer.accountName,
        refreshedCustomer?.first ?? customer.first,
        refreshedCustomer?.last ?? customer.last,
      ),
    };

    res.json({
      row,
      customer:
        contact.isPrimary && refreshedCustomer
          ? customerRow({
              _id: refreshedCustomer._id as mongoose.Types.ObjectId,
              accountName: refreshedCustomer.accountName,
              first: refreshedCustomer.first,
              last: refreshedCustomer.last,
              reputation: refreshedCustomer.reputation,
            })
          : null,
    });
  } catch (err) {
    console.error("PATCH /name-reports/contacts/:id error:", err);
    res.status(500).json({ message: "Failed to update contact name." });
  }
}

type VacantCustomerRow = {
  id: string;
  accountName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
};

function vacantCustomerQuery(search: string): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [
    {
      ...activeCustomerFilter,
      ...notMergedFilter,
    },
  ];
  const tokens = buildTokenSearchFilter(search, [
    "accountName",
    "address",
    "city",
    "state",
    "zip",
    "county",
  ]);
  if (tokens) parts.push(tokens);
  return parts.length === 1 ? parts[0] : { $and: parts };
}

function vacantContactLookup(): PipelineStage {
  return {
    $lookup: {
      from: CustomerContact.collection.name,
      let: { id: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$customerRef", "$$id"] },
                { $eq: ["$deletedAt", null] },
              ],
            },
          },
        },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: "activeContacts",
    },
  };
}

function vacantRow(customer: {
  _id: mongoose.Types.ObjectId;
  accountName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
}): VacantCustomerRow {
  return {
    id: customer._id.toString(),
    accountName: customer.accountName ?? "",
    address: customer.address ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    zip: customer.zip ?? "",
    county: customer.county ?? "",
  };
}

// GET /name-reports/vacant — active customers with no active contact.
export async function listVacantCustomers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: "Database unavailable. Please try again later." });
    return;
  }

  try {
    const pageSize = parsePageSize(req.query.pageSize);
    const requestedPage = parsePage(req.query.page);
    const filter = vacantCustomerQuery(String(req.query.q ?? ""));
    const withoutContacts: PipelineStage[] = [
      { $match: filter },
      vacantContactLookup(),
      { $match: { activeContacts: { $size: 0 } } },
    ];
    const counted = await Customer.aggregate<{ count: number }>([
      ...withoutContacts,
      { $count: "count" },
    ]);
    const total = counted[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const page = Math.min(requestedPage, totalPages);
    const customers = await Customer.aggregate<{
      _id: mongoose.Types.ObjectId;
      accountName?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      county?: string;
    }>([
      ...withoutContacts,
      { $sort: { accountName: 1, address: 1, _id: 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      {
        $project: {
          accountName: 1,
          address: 1,
          city: 1,
          state: 1,
          zip: 1,
          county: 1,
        },
      },
    ]);

    res.json({
      rows: customers.map(vacantRow),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /name-reports/vacant error:", err);
    res.status(500).json({ message: "Failed to list vacant customers." });
  }
}
