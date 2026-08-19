import { Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import { activeCustomerFilter, Customer } from "../models/mongo/Customer";
import {
  CustomerAddress,
  CustomerAddressPropertyType,
} from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { Contract } from "../models/mongo/Contract";
import { Equipment } from "../models/mongo/Equipment";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  createCustomerAddressSchema,
  createCustomerContactSchema,
  createEquipmentSchema,
  mergeCustomersSchema,
  updateCustomerAddressSchema,
  updateCustomerContactSchema,
  updateEquipmentSchema,
} from "../schemas/customerSite.schema";
import {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomerAddressNested,
  type CreateCustomerContactNested,
} from "../schemas/customer.schema";
import {
  ensureCustomerContactFromFlat,
  syncCustomerPrimaryContactFields,
} from "../utils/customerContacts";
import { ensureCustomerUser } from "../utils/ensureCustomerUser";
import {
  customerHasSiteData,
  defaultAddressLabel,
  ensureCustomerSiteFromFlat,
  normalizePhoneDigits,
  syncCustomerPrimaryFields,
} from "../utils/customerSites";
import { getContractStanding } from "../utils/contractDates";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import { normalizeCountyName } from "../constants/floridaCounties";
import {
  assertOwnerCanAccessCustomer,
  assignCustomerOwner,
  buildOwnerCustomerFilter,
} from "../utils/ownerTerritory";
import { User } from "../models/mongo/User";
import { resolveGeocodedAddress } from "../utils/resolveGeocodedAddress";

function parseLastSvc(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export interface SerialConflict {
  field: "serial" | "atsSerial";
  value: string;
  equipmentId: string;
  addressId: string | null;
  addressLabel: string | null;
  customerId: string;
  customerName: string | null;
}

/**
 * Finds equipment whose serial / atsSerial matches the provided values.
 * Conflicts on the SAME customer are "blocking" (a serial can live on only one
 * address per customer); conflicts on OTHER customers are non-blocking "warnings".
 * Blank serials are ignored.
 */
async function findSerialConflicts(
  customerId: mongoose.Types.ObjectId,
  input: { serial?: string; atsSerial?: string; excludeEquipmentId?: string },
): Promise<{ blocking: SerialConflict[]; warnings: SerialConflict[] }> {
  const serial = (input.serial ?? "").trim();
  const atsSerial = (input.atsSerial ?? "").trim();

  const orClauses: Record<string, unknown>[] = [];
  if (serial) {
    orClauses.push({ serial });
  }
  if (atsSerial) {
    orClauses.push({ atsSerial });
  }
  if (orClauses.length === 0) return { blocking: [], warnings: [] };

  const query: Record<string, unknown> = { $or: orClauses };
  if (
    input.excludeEquipmentId &&
    mongoose.Types.ObjectId.isValid(input.excludeEquipmentId)
  ) {
    query._id = { $ne: new mongoose.Types.ObjectId(input.excludeEquipmentId) };
  }

  const matches = await Equipment.find(query)
    .select("serial atsSerial addressRef customerRef")
    .lean();
  if (matches.length === 0) return { blocking: [], warnings: [] };

  const addressIds = [
    ...new Set(matches.map((m) => String(m.addressRef)).filter(Boolean)),
  ];
  const customerIds = [
    ...new Set(matches.map((m) => String(m.customerRef)).filter(Boolean)),
  ];
  const [addresses, customers] = await Promise.all([
    CustomerAddress.find({ _id: { $in: addressIds } })
      .select("label address city")
      .lean(),
    Customer.find({ _id: { $in: customerIds } })
      .select("accountName first last")
      .lean(),
  ]);
  const addrMap = new Map(addresses.map((a) => [String(a._id), a]));
  const custMap = new Map(customers.map((c) => [String(c._id), c]));

  const blocking: SerialConflict[] = [];
  const warnings: SerialConflict[] = [];
  const currentCustomerId = String(customerId);

  for (const m of matches) {
    const addr = addrMap.get(String(m.addressRef));
    const cust = custMap.get(String(m.customerRef));
    const addressLabel = addr
      ? addr.label?.trim() ||
        [addr.address, addr.city].filter(Boolean).join(", ") ||
        null
      : null;
    const customerName = cust
      ? (() => {
          const account = (cust.accountName ?? "").trim();
          if (account) return account;
          return (
            [cust.first, cust.last].filter(Boolean).join(" ").trim() || null
          );
        })()
      : null;
    const base = {
      equipmentId: String(m._id),
      addressId: m.addressRef ? String(m.addressRef) : null,
      addressLabel,
      customerId: String(m.customerRef),
      customerName,
    };
    const bucket =
      String(m.customerRef) === currentCustomerId ? blocking : warnings;

    if (serial && String(m.serial).trim() === serial) {
      bucket.push({ ...base, field: "serial", value: serial });
    }
    if (atsSerial && String(m.atsSerial).trim() === atsSerial) {
      bucket.push({ ...base, field: "atsSerial", value: atsSerial });
    }
  }

  return { blocking, warnings };
}

function serialConflictMessage(conflicts: SerialConflict[]): string {
  const c = conflicts[0];
  if (!c) return "This serial number is already in use for this customer.";
  const fieldLabel = c.field === "atsSerial" ? "ATS serial" : "Serial";
  const where = c.addressLabel
    ? ` (already on "${c.addressLabel}")`
    : " (already on another address)";
  return `${fieldLabel} "${c.value}" is already assigned to equipment for this customer${where}. A serial can only be used on one address.`;
}

function formatAddress(doc: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  countyManual?: boolean;
  isPrimary?: boolean;
  propertyType?: CustomerAddressPropertyType;
  legacyCustomerId?: number | null;
  lat?: number | null;
  lng?: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    customerRef: doc.customerRef.toString(),
    label: doc.label ?? "",
    address: doc.address ?? "",
    city: doc.city ?? "",
    state: doc.state ?? "",
    zip: doc.zip ?? "",
    county: doc.county ?? "",
    countyManual: Boolean(doc.countyManual),
    isPrimary: Boolean(doc.isPrimary),
    propertyType: doc.propertyType ?? "residential",
    legacyCustomerId: doc.legacyCustomerId ?? null,
    lat: typeof doc.lat === "number" ? doc.lat : null,
    lng: typeof doc.lng === "number" ? doc.lng : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function formatEquipment(doc: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  addressRef: mongoose.Types.ObjectId;
  generatorModel?: string;
  serial?: string;
  atsSerial?: string;
  lastSvc?: Date | null;
  exday?: string;
  extime?: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    customerRef: doc.customerRef.toString(),
    addressRef: doc.addressRef.toString(),
    generatorModel: doc.generatorModel ?? "",
    serial: doc.serial ?? "",
    atsSerial: doc.atsSerial ?? "",
    lastSvc: doc.lastSvc ? doc.lastSvc.toISOString() : null,
    exday: doc.exday ?? "",
    extime: doc.extime ?? "",
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function formatContact(doc: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  label?: string;
  isPrimary?: boolean;
  userRef?: mongoose.Types.ObjectId | null;
  legacyCustomerId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    customerRef: doc.customerRef.toString(),
    first: doc.first ?? "",
    last: doc.last ?? "",
    phone: doc.phone ?? "",
    email: doc.email ?? "",
    label: doc.label ?? "",
    isPrimary: Boolean(doc.isPrimary),
    userRef: doc.userRef ? doc.userRef.toString() : null,
    legacyCustomerId: doc.legacyCustomerId ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function findActiveCustomerOr404(
  customerId: string,
  res: Response,
  accessUser?: { id: string; role: string } | null,
): Promise<{
  _id: mongoose.Types.ObjectId;
  legacyId: number;
  accountName: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  ownerUserRef?: mongoose.Types.ObjectId | null;
  generatorModel: string;
  serial: string;
  atsSerial: string;
  lastSvc: Date | null;
  exday: string;
  extime: string;
  mergedIntoRef?: mongoose.Types.ObjectId | null;
  deletedAt?: Date | null;
} | null> {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    res.status(400).json({ message: "Invalid customer id" });
    return null;
  }

  const customer = await Customer.findOne({
    _id: customerId,
    ...activeCustomerFilter,
  }).lean();
  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return null;
  }

  if (
    accessUser &&
    !(await assertOwnerCanAccessCustomer(accessUser, customer))
  ) {
    res.status(403).json({ message: "Customer is outside your territory" });
    return null;
  }

  return {
    ...customer,
    accountName: customer.accountName ?? "",
  };
}

const notMergedFilter: {
  $or: Array<{ mergedIntoRef: null } | { mergedIntoRef: { $exists: false } }>;
} = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

function trimStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function loadSitesForCustomer(customerId: mongoose.Types.ObjectId) {
  const addresses = await CustomerAddress.find({ customerRef: customerId })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();
  const equipment = await Equipment.find({ customerRef: customerId })
    .sort({ createdAt: 1 })
    .lean();

  const equipmentByAddress = new Map<
    string,
    ReturnType<typeof formatEquipment>[]
  >();
  for (const item of equipment) {
    const key = item.addressRef.toString();
    const list = equipmentByAddress.get(key) ?? [];
    list.push(formatEquipment(item));
    equipmentByAddress.set(key, list);
  }

  return addresses.map((addr) => ({
    ...formatAddress(addr),
    equipment: equipmentByAddress.get(addr._id.toString()) ?? [],
  }));
}

async function loadContactsForCustomer(customerId: mongoose.Types.ObjectId) {
  const contacts = await CustomerContact.find({ customerRef: customerId })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();
  return contacts.map(formatContact);
}

async function clearOtherPrimary(
  customerId: mongoose.Types.ObjectId,
  keepAddressId?: mongoose.Types.ObjectId,
): Promise<void> {
  const filter: Record<string, unknown> = { customerRef: customerId };
  if (keepAddressId) {
    filter._id = { $ne: keepAddressId };
  }
  await CustomerAddress.updateMany(filter, { $set: { isPrimary: false } });
}

async function clearOtherPrimaryContacts(
  customerId: mongoose.Types.ObjectId,
  keepContactId?: mongoose.Types.ObjectId,
): Promise<void> {
  const filter: Record<string, unknown> = { customerRef: customerId };
  if (keepContactId) {
    filter._id = { $ne: keepContactId };
  }
  await CustomerContact.updateMany(filter, { $set: { isPrimary: false } });
}

// GET /customers — exclude merged; ?deleted=1 for soft-deleted only.
// Server-side pagination, search and sort for scalability.
const CUSTOMER_PAGE_SIZES = [25, 50, 150, 250, 500];
const CUSTOMER_SORT_KEYS = new Set([
  "customer",
  "phone",
  "street",
  "city",
  "state",
  "zip",
]);

/** Case-insensitive trim of a possibly-missing string field for sorting. */
function trimFieldExpr(field: string): Record<string, unknown> {
  return { $trim: { input: { $ifNull: [field, ""] } } };
}

/** Aggregation expression for the active sort column's normalized sort key. */
function buildSortKeyExpr(sortKey: string): Record<string, unknown> {
  switch (sortKey) {
    case "phone":
      return { $ifNull: ["$phoneDigits", ""] };
    case "street":
      return trimFieldExpr("$address");
    case "city":
      return trimFieldExpr("$city");
    case "state":
      return trimFieldExpr("$state");
    case "zip":
      return trimFieldExpr("$zip");
    case "customer":
    default:
      // Prefer durable accountName; fall back to "First Last".
      return {
        $trim: {
          input: {
            $cond: [
              {
                $gt: [
                  {
                    $strLenCP: {
                      $trim: { input: { $ifNull: ["$accountName", ""] } },
                    },
                  },
                  0,
                ],
              },
              trimFieldExpr("$accountName"),
              {
                $concat: [trimFieldExpr("$first"), " ", trimFieldExpr("$last")],
              },
            ],
          },
        },
      };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listCustomers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const deletedOnly =
      req.query.deleted === "1" || req.query.deleted === "true";

    const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10);
    const pageSize = CUSTOMER_PAGE_SIZES.includes(pageSizeRaw)
      ? pageSizeRaw
      : 25;

    const sortDir = req.query.sortDir === "desc" ? -1 : 1;
    const sortKeyRaw = String(req.query.sortKey ?? "customer");
    const sortKey = CUSTOMER_SORT_KEYS.has(sortKeyRaw)
      ? sortKeyRaw
      : "customer";

    const ownerScope = req.user
      ? await buildOwnerCustomerFilter({ id: req.user.id, role: req.user.role })
      : null;

    const baseFilter: Record<string, unknown> = {
      ...notMergedFilter,
      ...(deletedOnly ? { deletedAt: { $ne: null } } : activeCustomerFilter),
      ...(ownerScope ?? {}),
    };

    const search = trimStr(req.query.search);
    let filter: Record<string, unknown> = baseFilter;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      const or: Array<Record<string, unknown>> = [
        { accountName: rx },
        { first: rx },
        { last: rx },
        { address: rx },
        { city: rx },
        { state: rx },
        { zip: rx },
        { county: rx },
        { phone: rx },
      ];
      const digits = normalizePhoneDigits(search);
      if (digits.length > 0) {
        or.push({ phoneDigits: new RegExp(escapeRegex(digits)) });
      }
      filter = { $and: [baseFilter, { $or: or }] };
    }

    const total = await Customer.countDocuments(filter);

    // Sort on a normalized key (trimmed, mirrors the displayed name) so the
    // order is a true digits-then-A–Z alphabetical sort of what users see.
    const customers = await Customer.aggregate([
      { $match: filter },
      { $addFields: { __sortKey: buildSortKeyExpr(sortKey) } },
      { $sort: { __sortKey: sortDir, _id: 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $project: { __sortKey: 0 } },
    ]).collation({ locale: "en", strength: 2 });

    // Duplicate detection scoped to the current page: count how many customers
    // in the same list share each page phone (indexed phoneDigits lookup).
    const pageDigits = [
      ...new Set(
        customers
          .map((c) => normalizePhoneDigits(c.phone))
          .filter((d) => d.length >= 7),
      ),
    ];
    const duplicateByDigits = new Map<string, number>();
    if (pageDigits.length > 0) {
      const grouped = await Customer.aggregate<{ _id: string; count: number }>([
        { $match: { ...baseFilter, phoneDigits: { $in: pageDigits } } },
        { $group: { _id: "$phoneDigits", count: { $sum: 1 } } },
      ]);
      for (const g of grouped) duplicateByDigits.set(g._id, g.count);
    }

    // Contract badges for the visible page only.
    const legacyIds = customers.map((c) => c.legacyId);
    const contractsByCustomer = new Map<
      number,
      Array<{
        _id: string;
        standing: string;
        contractType: string | null;
        template: { label: string; badgeIcon: string } | null;
      }>
    >();
    if (legacyIds.length > 0) {
      const contracts = await Contract.find({
        customerId: { $in: legacyIds },
      })
        .select("customerId renewalDueDate templateId contractType")
        .lean();

      const templateIds = [
        ...new Set(
          contracts
            .map((c) => c.templateId?.toString())
            .filter((v): v is string => Boolean(v)),
        ),
      ];
      const templateById = new Map<
        string,
        { label: string; badgeIcon: string }
      >();
      if (templateIds.length > 0) {
        const templates = await ContractTemplate.find({
          _id: { $in: templateIds },
        })
          .select("_id label badgeIcon")
          .lean();
        for (const t of templates) {
          templateById.set(t._id.toString(), {
            label: t.label ?? "",
            badgeIcon: t.badgeIcon ?? "scroll-text",
          });
        }
      }

      for (const c of contracts) {
        const list = contractsByCustomer.get(c.customerId) ?? [];
        list.push({
          _id: (c._id as mongoose.Types.ObjectId).toString(),
          standing: getContractStanding(c.renewalDueDate ?? null),
          contractType: c.contractType ?? null,
          template: c.templateId
            ? (templateById.get(c.templateId.toString()) ?? null)
            : null,
        });
        contractsByCustomer.set(c.customerId, list);
      }
    }

    const ownerIds = [
      ...new Set(
        customers
          .map((c) => (c.ownerUserRef ? String(c.ownerUserRef) : ""))
          .filter(Boolean),
      ),
    ];
    const ownerById = new Map<
      string,
      { _id: string; first_name: string; last_name: string; email: string }
    >();
    if (ownerIds.length > 0) {
      const owners = await User.find({ _id: { $in: ownerIds } })
        .select("_id first_name last_name email")
        .lean();
      for (const o of owners) {
        ownerById.set(String(o._id), {
          _id: String(o._id),
          first_name: o.first_name,
          last_name: o.last_name,
          email: o.email,
        });
      }
    }

    res.status(200).json({
      customers: customers.map((c) => {
        const digits = normalizePhoneDigits(c.phone);
        const peers =
          digits.length >= 7
            ? Math.max(0, (duplicateByDigits.get(digits) ?? 1) - 1)
            : 0;
        const ownerId = c.ownerUserRef ? String(c.ownerUserRef) : null;
        return {
          ...c,
          ownerUserRef: ownerId,
          owner: ownerId ? (ownerById.get(ownerId) ?? null) : null,
          deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
          duplicateCount: peers,
          contracts: contractsByCustomer.get(c.legacyId) ?? [],
        };
      }),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /customers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

const CONTACT_PAGE_SIZES = [25, 50, 150, 250, 500];
const CONTACT_SORT_KEYS = new Set([
  "name",
  "phone",
  "email",
  "label",
  "customer",
  "primary",
]);

/** Prefix plain field keys for nested customer match after $lookup/$unwind. */
function prefixFilterKeys(
  filter: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("$")) {
      if (Array.isArray(value)) {
        out[key] = value.map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? prefixFilterKeys(item as Record<string, unknown>, prefix)
            : item,
        );
      } else if (value && typeof value === "object") {
        out[key] = prefixFilterKeys(value as Record<string, unknown>, prefix);
      } else {
        out[key] = value;
      }
    } else {
      out[`${prefix}${key}`] = value;
    }
  }
  return out;
}

function buildContactSortKeyExpr(sortKey: string): Record<string, unknown> {
  switch (sortKey) {
    case "phone":
      return trimFieldExpr("$phone");
    case "email":
      return trimFieldExpr("$email");
    case "label":
      return trimFieldExpr("$label");
    case "primary":
      return { $cond: ["$isPrimary", 0, 1] };
    case "customer":
      return {
        $trim: {
          input: {
            $cond: [
              {
                $gt: [
                  {
                    $strLenCP: {
                      $trim: {
                        input: { $ifNull: ["$customer.accountName", ""] },
                      },
                    },
                  },
                  0,
                ],
              },
              trimFieldExpr("$customer.accountName"),
              {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$customer.first", ""] },
                      " ",
                      { $ifNull: ["$customer.last", ""] },
                    ],
                  },
                },
              },
            ],
          },
        },
      };
    case "name":
    default:
      return {
        $trim: {
          input: {
            $concat: [
              { $ifNull: ["$last", ""] },
              " ",
              { $ifNull: ["$first", ""] },
            ],
          },
        },
      };
  }
}

// GET /customers/contacts — list contacts across active customers
export async function listContacts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10);
    const pageSize = CONTACT_PAGE_SIZES.includes(pageSizeRaw)
      ? pageSizeRaw
      : 25;

    const sortDir: 1 | -1 = req.query.sortDir === "desc" ? -1 : 1;
    const sortKeyRaw = String(req.query.sortKey ?? "name");
    const sortKey = CONTACT_SORT_KEYS.has(sortKeyRaw) ? sortKeyRaw : "name";

    const ownerScope = req.user
      ? await buildOwnerCustomerFilter({ id: req.user.id, role: req.user.role })
      : null;

    const customerMatch: Record<string, unknown> = {
      ...prefixFilterKeys(
        {
          ...activeCustomerFilter,
          ...notMergedFilter,
          ...(ownerScope ?? {}),
        },
        "customer.",
      ),
    };

    const search = trimStr(req.query.search);
    const searchMatch: Record<string, unknown> | null = search
      ? (() => {
          const rx = new RegExp(escapeRegex(search), "i");
          const or: Array<Record<string, unknown>> = [
            { first: rx },
            { last: rx },
            { phone: rx },
            { email: rx },
            { label: rx },
            { "customer.accountName": rx },
            { "customer.first": rx },
            { "customer.last": rx },
            { "customer.phone": rx },
          ];
          const digits = normalizePhoneDigits(search);
          if (digits.length > 0) {
            const digitRx = new RegExp(escapeRegex(digits));
            or.push({ phone: digitRx });
            or.push({ "customer.phoneDigits": digitRx });
          }
          return { $or: or };
        })()
      : null;

    const pipeline: mongoose.PipelineStage[] = [
      {
        $lookup: {
          from: "customers",
          localField: "customerRef",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: "$customer" },
      { $match: customerMatch },
    ];
    if (searchMatch) {
      pipeline.push({ $match: searchMatch });
    }
    pipeline.push({
      $facet: {
        total: [{ $count: "count" }],
        items: [
          { $addFields: { __sortKey: buildContactSortKeyExpr(sortKey) } },
          { $sort: { __sortKey: sortDir, _id: 1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          { $project: { __sortKey: 0 } },
        ],
      },
    });

    const [facet] = await CustomerContact.aggregate<{
      total: Array<{ count: number }>;
      items: Array<{
        _id: mongoose.Types.ObjectId;
        customerRef: mongoose.Types.ObjectId;
        first?: string;
        last?: string;
        phone?: string;
        email?: string;
        label?: string;
        isPrimary?: boolean;
        userRef?: mongoose.Types.ObjectId | null;
        legacyCustomerId?: number | null;
        createdAt: Date;
        updatedAt: Date;
        customer: {
          _id: mongoose.Types.ObjectId;
          accountName?: string;
          first?: string;
          last?: string;
        };
      }>;
    }>(pipeline).collation({ locale: "en", strength: 2 });

    const total = facet?.total[0]?.count ?? 0;
    const contacts = (facet?.items ?? []).map((doc) => ({
      ...formatContact(doc),
      customer: {
        _id: doc.customer._id.toString(),
        accountName: doc.customer.accountName ?? "",
        first: doc.customer.first ?? "",
        last: doc.customer.last ?? "",
      },
    }));

    res.status(200).json({
      contacts,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /customers/contacts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/validate-address — Google Address Validation, falling back to Census geocode
export async function validateCustomerAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const input = {
      street: trimStr(req.body?.address ?? req.body?.street),
      city: trimStr(req.body?.city),
      state: trimStr(req.body?.state),
      zip: trimStr(req.body?.zip),
    };

    const result = await resolveGeocodedAddress(input);

    if (!result.ok) {
      res.status(200).json({
        valid: false,
        message: result.message,
      });
      return;
    }

    res.status(200).json({
      valid: true,
      matchedAddress: result.match.matchedAddress,
      address: result.match.normalized,
      coordinates: result.match.coordinates,
    });
  } catch (err) {
    console.error("POST /customers/validate-address error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers — admin create
export async function createCustomer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const normalized = normalizeCreateCustomerBody(req.body);
    const parsed = createCustomerSchema.safeParse(normalized);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const input = parsed.data;
    const contacts = resolvePrimaryContacts(input.contacts);
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
    if (!primaryHasReachability(primary)) {
      res.status(400).json({
        message:
          "Primary contact requires a valid phone number and/or email address",
      });
      return;
    }

    let accountName = trimStr(input.accountName);
    if (!accountName) {
      accountName = `${primary.first} ${primary.last}`.trim();
    }

    // Pre-validate / geocode addresses that have a street before writing anything.
    const preparedAddresses: Array<{
      label: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      county: string;
      countyManual: boolean;
      propertyType: CustomerAddressPropertyType;
      isPrimary: boolean;
      lat: number | null;
      lng: number | null;
      equipment: CreateCustomerAddressNested["equipment"];
    }> = [];

    for (const addr of input.addresses) {
      const street = trimStr(addr.address);
      const city = trimStr(addr.city);
      const state = trimStr(addr.state);
      const zip = trimStr(addr.zip);
      const manualCounty = normalizeCountyName(addr.county);
      const countyManualInput = addr.countyManual === true;
      const hasAny =
        street ||
        city ||
        state ||
        zip ||
        trimStr(addr.label) ||
        manualCounty ||
        (addr.equipment?.length ?? 0) > 0;
      if (!hasAny) continue;

      if (!street) {
        res.status(400).json({
          message: "Street address is required when adding a property",
        });
        return;
      }

      const geocode = await resolveGeocodedAddress({
        street,
        city,
        state,
        zip,
      });
      if (!geocode.ok) {
        const status =
          geocode.reason === "incomplete"
            ? 400
            : geocode.reason === "upstream_error"
              ? 502
              : 422;
        res.status(status).json({ message: geocode.message });
        return;
      }

      const normalizedAddr = geocode.match.normalized;
      const geocodedCounty = normalizeCountyName(normalizedAddr.county);
      const countyManual =
        countyManualInput ||
        (Boolean(manualCounty) &&
          Boolean(geocodedCounty) &&
          manualCounty !== geocodedCounty);
      const county = countyManual
        ? manualCounty || geocodedCounty
        : geocodedCounty || manualCounty;

      preparedAddresses.push({
        label: trimStr(addr.label),
        address: normalizedAddr.address,
        city: normalizedAddr.city,
        state: normalizedAddr.state,
        zip: normalizedAddr.zip,
        county,
        countyManual,
        propertyType:
          addr.propertyType === "commercial" ? "commercial" : "residential",
        isPrimary: addr.isPrimary === true,
        lat: geocode.match.coordinates?.lat ?? null,
        lng: geocode.match.coordinates?.lng ?? null,
        equipment: addr.equipment ?? [],
      });
    }

    // Ensure exactly one primary address when any exist.
    if (preparedAddresses.length > 0) {
      const primaryIdx = preparedAddresses.findIndex((a) => a.isPrimary);
      if (primaryIdx < 0) {
        preparedAddresses[0].isPrimary = true;
      } else {
        preparedAddresses.forEach((a, i) => {
          a.isPrimary = i === primaryIdx;
        });
      }
    }

    // Reject duplicate serials within the incoming payload (same customer).
    const seenSerials = new Set<string>();
    const seenAts = new Set<string>();
    for (const addr of preparedAddresses) {
      for (const eq of addr.equipment ?? []) {
        const serial = trimStr(eq.serial);
        const atsSerial = trimStr(eq.atsSerial);
        if (serial) {
          if (seenSerials.has(serial)) {
            res.status(409).json({
              message: `Serial "${serial}" is used more than once on this customer`,
            });
            return;
          }
          seenSerials.add(serial);
        }
        if (atsSerial) {
          if (seenAts.has(atsSerial)) {
            res.status(409).json({
              message: `ATS serial "${atsSerial}" is used more than once on this customer`,
            });
            return;
          }
          seenAts.add(atsSerial);
        }
      }
    }

    const maxLegacy = await Customer.findOne()
      .sort({ legacyId: -1 })
      .select("legacyId")
      .lean();
    const legacyId = (maxLegacy?.legacyId ?? 0) + 1;

    const primarySite = preparedAddresses.find((a) => a.isPrimary);
    const phone = trimStr(primary.phone);
    const email = trimStr(primary.email).toLowerCase();

    const customer = await Customer.create({
      legacyId,
      userId: 0,
      accountName,
      first: trimStr(primary.first),
      last: trimStr(primary.last),
      phone,
      phoneDigits: normalizePhoneDigits(phone),
      email,
      address: primarySite?.address ?? "",
      city: primarySite?.city ?? "",
      state: primarySite?.state ?? "",
      zip: primarySite?.zip ?? "",
      county: primarySite?.county ?? "",
      ownerUserRef: null,
      deletedAt: null,
      mergedIntoRef: null,
      mergedAt: null,
    });

    try {
      for (const contact of contacts) {
        const contactDoc = await CustomerContact.create({
          customerRef: customer._id,
          first: trimStr(contact.first),
          last: trimStr(contact.last),
          phone: trimStr(contact.phone),
          email: trimStr(contact.email).toLowerCase(),
          label: trimStr(contact.label),
          isPrimary: contact.isPrimary === true,
          legacyCustomerId: legacyId,
        });
        await ensureCustomerUser(contactDoc);
      }

      for (const addr of preparedAddresses) {
        const addressDoc = await CustomerAddress.create({
          customerRef: customer._id,
          label: addr.label || defaultAddressLabel(addr.city, addr.address),
          address: addr.address,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
          county: addr.county,
          countyManual: addr.countyManual,
          isPrimary: addr.isPrimary,
          propertyType: addr.propertyType,
          legacyCustomerId: legacyId,
          lat: addr.lat,
          lng: addr.lng,
        });

        for (const eq of addr.equipment ?? []) {
          const serial = trimStr(eq.serial);
          const atsSerial = trimStr(eq.atsSerial);
          const generatorModel = trimStr(eq.generatorModel);
          const exday = trimStr(eq.exday);
          const extime = trimStr(eq.extime);
          const lastSvc = parseLastSvc(eq.lastSvc);
          if (
            !serial &&
            !atsSerial &&
            !generatorModel &&
            !exday &&
            !extime &&
            lastSvc === undefined
          ) {
            continue;
          }

          const { blocking } = await findSerialConflicts(customer._id, {
            serial,
            atsSerial,
          });
          if (blocking.length > 0) {
            const conflictErr = new Error(
              serialConflictMessage(blocking),
            ) as Error & {
              status: number;
              conflicts: SerialConflict[];
            };
            conflictErr.status = 409;
            conflictErr.conflicts = blocking;
            throw conflictErr;
          }

          await Equipment.create({
            customerRef: customer._id,
            addressRef: addressDoc._id,
            generatorModel,
            serial,
            atsSerial,
            lastSvc: lastSvc === undefined ? null : lastSvc,
            exday,
            extime,
          });
        }
      }

      await syncCustomerPrimaryFields(customer._id);
      await syncCustomerPrimaryContactFields(customer._id);
      await assignCustomerOwner(customer._id);
      // Re-apply durable account name after contact sync (sync does not touch it,
      // but refresh the in-memory doc for the response).
      await Customer.findByIdAndUpdate(customer._id, {
        $set: { accountName },
      });
    } catch (err) {
      await cleanupPartialCustomer(customer._id);
      const conflictErr = err as Error & {
        status?: number;
        conflicts?: SerialConflict[];
      };
      if (conflictErr?.status === 409) {
        res.status(409).json({
          message: conflictErr.message,
          conflicts: conflictErr.conflicts,
        });
        return;
      }
      throw err;
    }

    const fresh = await Customer.findById(customer._id).lean();
    const custName = customerDisplayName(fresh ?? customer);
    logNotificationAsync({
      entityType: "customer",
      action: "created",
      entityId: String(customer._id),
      customerRef: customer._id,
      summary: `Customer ${custName} created`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      customer: {
        _id: customer._id.toString(),
        legacyId: fresh?.legacyId ?? customer.legacyId,
        accountName: fresh?.accountName ?? accountName,
        first: fresh?.first ?? customer.first,
        last: fresh?.last ?? customer.last,
        email: fresh?.email ?? customer.email,
        phone: fresh?.phone ?? customer.phone,
        address: fresh?.address ?? customer.address,
        city: fresh?.city ?? customer.city,
        state: fresh?.state ?? customer.state,
        zip: fresh?.zip ?? customer.zip,
        generatorModel: fresh?.generatorModel ?? customer.generatorModel ?? "",
        lastSvc: fresh?.lastSvc
          ? fresh.lastSvc.toISOString()
          : customer.lastSvc
            ? customer.lastSvc.toISOString()
            : null,
        deletedAt: null,
        duplicateCount: 0,
      },
    });
  } catch (err) {
    console.error("POST /customers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

function isValidCreateEmail(email: string): boolean {
  if (!email) return false;
  return z.string().email().safeParse(email).success;
}

function isValidCreatePhone(phone: string): boolean {
  return normalizePhoneDigits(phone).length === 10;
}

function primaryHasReachability(contact: {
  phone?: string;
  email?: string;
}): boolean {
  const phone = trimStr(contact.phone);
  const email = trimStr(contact.email).toLowerCase();
  return isValidCreatePhone(phone) || isValidCreateEmail(email);
}

function resolvePrimaryContacts(
  contacts: CreateCustomerContactNested[],
): Array<CreateCustomerContactNested & { isPrimary: boolean }> {
  const primaryIdx = contacts.findIndex((c) => c.isPrimary === true);
  const idx = primaryIdx >= 0 ? primaryIdx : 0;
  return contacts.map((c, i) => ({ ...c, isPrimary: i === idx }));
}

/** Accept legacy flat create body or rich nested body. */
function normalizeCreateCustomerBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.contacts)) return body;

  const contacts = [
    {
      first: b.first ?? "",
      last: b.last ?? "",
      phone: b.phone ?? "",
      email: b.email ?? "",
      label: "",
      isPrimary: true,
    },
  ];
  const addresses: CreateCustomerAddressNested[] = [];
  if (trimStr(b.address)) {
    addresses.push({
      label: "",
      address: String(b.address ?? ""),
      city: String(b.city ?? ""),
      state: String(b.state ?? ""),
      zip: String(b.zip ?? ""),
      county: String(b.county ?? ""),
      countyManual: b.countyManual === true,
      propertyType:
        b.propertyType === "commercial" ? "commercial" : "residential",
      isPrimary: true,
      equipment: [],
    });
  }
  return {
    accountName: b.accountName ?? "",
    contacts,
    addresses,
  };
}

async function cleanupPartialCustomer(
  customerId: mongoose.Types.ObjectId,
): Promise<void> {
  await Promise.all([
    Equipment.deleteMany({ customerRef: customerId }),
    CustomerAddress.deleteMany({ customerRef: customerId }),
    CustomerContact.deleteMany({ customerRef: customerId }),
  ]);
  await Customer.deleteOne({ _id: customerId });
}

// PATCH /customers/:id — update durable account name
export async function updateCustomer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = updateCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const accountName = parsed.data.accountName;
    await Customer.findByIdAndUpdate(customer._id, {
      $set: { accountName },
    });

    const custName = customerDisplayName({
      accountName,
      first: customer.first,
      last: customer.last,
    });
    logNotificationAsync({
      entityType: "customer",
      action: "updated",
      entityId: String(customer._id),
      customerRef: customer._id,
      summary: `Customer ${custName} updated`,
      metadata: { customerName: custName, accountName },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      customer: {
        _id: customer._id.toString(),
        legacyId: customer.legacyId,
        accountName,
        first: customer.first,
        last: customer.last,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
        generatorModel: customer.generatorModel ?? "",
        lastSvc: customer.lastSvc ? customer.lastSvc.toISOString() : null,
        deletedAt: customer.deletedAt ? customer.deletedAt.toISOString() : null,
      },
    });
  } catch (err) {
    console.error("PATCH /customers/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/promote — clear the temporary/lead-origin flag
export async function promoteCustomer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }

    const customer = await Customer.findOne({
      _id: id,
      ...activeCustomerFilter,
      ...notMergedFilter,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    if (customer.isTemporary) {
      customer.isTemporary = false;
      await customer.save();

      const custName = customerDisplayName(customer);
      logNotificationAsync({
        entityType: "customer",
        action: "updated",
        entityId: String(customer._id),
        customerRef: customer._id,
        summary: `Customer ${custName} promoted from lead`,
        metadata: { customerName: custName },
        ...actorFromRequest(req.user),
      });
    }

    res.status(200).json({
      customer: {
        _id: customer._id.toString(),
        isTemporary: customer.isTemporary,
      },
    });
  } catch (err) {
    console.error("PATCH /customers/:id/promote error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id — soft delete
export async function softDeleteCustomer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }

    const customer = await Customer.findOne({
      _id: id,
      ...activeCustomerFilter,
      ...notMergedFilter,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    customer.deletedAt = new Date();
    await customer.save();

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "customer",
      action: "deleted",
      entityId: String(customer._id),
      customerRef: customer._id,
      summary: `Customer ${custName} deleted`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      message: "Customer deleted",
      customer: {
        _id: customer._id.toString(),
        deletedAt: customer.deletedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("DELETE /customers/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/restore
export async function restoreCustomer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }

    const customer = await Customer.findOne({
      _id: id,
      deletedAt: { $ne: null },
      ...notMergedFilter,
    });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    customer.deletedAt = null;
    await customer.save();

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "customer",
      action: "updated",
      entityId: String(customer._id),
      customerRef: customer._id,
      summary: `Customer ${custName} restored`,
      metadata: { customerName: custName, restored: true },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      message: "Customer restored",
      customer: {
        _id: customer._id.toString(),
        deletedAt: null,
      },
    });
  } catch (err) {
    console.error("POST /customers/:id/restore error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/duplicates?phone=
export async function getCustomerDuplicates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const phone = normalizePhoneDigits(String(req.query.phone ?? ""));
    if (phone.length < 7) {
      res
        .status(400)
        .json({ message: "phone query with at least 7 digits is required" });
      return;
    }

    const excludeId = req.query.excludeId
      ? String(req.query.excludeId)
      : undefined;

    const customers = await Customer.find({
      ...notMergedFilter,
      ...activeCustomerFilter,
    })
      .select("_id legacyId first last phone email address city state zip")
      .lean();

    const contacts = await CustomerContact.find({
      customerRef: { $in: customers.map((c) => c._id) },
    })
      .select("customerRef phone")
      .lean();

    const matchingCustomerIds = new Set<string>();
    for (const contact of contacts) {
      if (normalizePhoneDigits(contact.phone) === phone) {
        matchingCustomerIds.add(contact.customerRef.toString());
      }
    }
    for (const c of customers) {
      if (normalizePhoneDigits(c.phone) === phone) {
        matchingCustomerIds.add(c._id.toString());
      }
    }

    const matches = customers.filter((c) => {
      if (excludeId && c._id.toString() === excludeId) return false;
      return matchingCustomerIds.has(c._id.toString());
    });

    res.status(200).json({
      phone,
      customers: matches.map((c) => ({
        _id: c._id.toString(),
        legacyId: c.legacyId,
        first: c.first,
        last: c.last,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
      })),
    });
  } catch (err) {
    console.error("GET /customers/duplicates error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id — enriched with sites
export async function getCustomerById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;

    if (customer.mergedIntoRef) {
      res.status(404).json({
        message: "Customer was merged into another account",
        mergedIntoRef: customer.mergedIntoRef.toString(),
      });
      return;
    }

    const existingSites = await CustomerAddress.countDocuments({
      customerRef: customer._id,
    });
    if (existingSites === 0 && customerHasSiteData(customer)) {
      await ensureCustomerSiteFromFlat(customer);
      const addressId = (
        await CustomerAddress.findOne({ customerRef: customer._id })
          .select("_id")
          .lean()
      )?._id;
      if (addressId) {
        await WorkOrder.updateMany(
          {
            customerId: customer.legacyId,
            $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
          },
          { $set: { addressRef: addressId, customerRef: customer._id } },
        );
        await Contract.updateMany(
          {
            customerId: customer.legacyId,
            $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
          },
          { $set: { addressRef: addressId, customerRef: customer._id } },
        );
      }
    }

    await ensureCustomerContactFromFlat(customer);

    // Lazy ZIP→county + owner fill so detail never stays blank after imports
    // when bulk Recalculate hasn't finished yet.
    if (
      !String(customer.county ?? "").trim() ||
      customer.ownerUserRef == null
    ) {
      await assignCustomerOwner(customer._id, {
        fillMissingCounty: true,
        allowCensus: false,
      });
      const refreshed = await Customer.findById(customer._id).lean();
      if (refreshed) {
        customer.county = refreshed.county ?? "";
        customer.ownerUserRef = refreshed.ownerUserRef ?? null;
        customer.zip = refreshed.zip ?? customer.zip;
        customer.city = refreshed.city ?? customer.city;
        customer.state = refreshed.state ?? customer.state;
        customer.address = refreshed.address ?? customer.address;
      }
    }

    const [addresses, contacts] = await Promise.all([
      loadSitesForCustomer(customer._id),
      loadContactsForCustomer(customer._id),
    ]);

    let owner: {
      _id: string;
      first_name: string;
      last_name: string;
      email: string;
    } | null = null;
    if (customer.ownerUserRef) {
      const ownerDoc = await User.findById(customer.ownerUserRef)
        .select("_id first_name last_name email")
        .lean();
      if (ownerDoc) {
        owner = {
          _id: String(ownerDoc._id),
          first_name: ownerDoc.first_name,
          last_name: ownerDoc.last_name,
          email: ownerDoc.email,
        };
      }
    }

    res.status(200).json({
      customer: {
        ...customer,
        _id: customer._id.toString(),
        ownerUserRef: customer.ownerUserRef
          ? String(customer.ownerUserRef)
          : null,
        owner,
        lastSvc: customer.lastSvc ? customer.lastSvc.toISOString() : null,
        mergedIntoRef: null,
        addresses,
        contacts,
      },
    });
  } catch (err) {
    console.error("GET /customers/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/addresses
export async function getCustomerAddresses(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addresses = await loadSitesForCustomer(customer._id);
    res.status(200).json({ addresses });
  } catch (err) {
    console.error("GET /customers/:id/addresses error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/addresses
export async function createCustomerAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = createCustomerAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const existingCount = await CustomerAddress.countDocuments({
      customerRef: customer._id,
    });
    const makePrimary = parsed.data.isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await clearOtherPrimary(customer._id);
    }

    const county = normalizeCountyName(parsed.data.county);
    const countyManual = parsed.data.countyManual === true || Boolean(county);

    let lat: number | null = null;
    let lng: number | null = null;
    const street = trimStr(parsed.data.address);
    if (street) {
      const geocode = await resolveGeocodedAddress({
        street,
        city: trimStr(parsed.data.city),
        state: trimStr(parsed.data.state),
        zip: trimStr(parsed.data.zip),
      });
      if (geocode.ok) {
        lat = geocode.match.coordinates?.lat ?? null;
        lng = geocode.match.coordinates?.lng ?? null;
      }
    }

    const address = await CustomerAddress.create({
      customerRef: customer._id,
      label: parsed.data.label,
      address: parsed.data.address,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      county,
      countyManual,
      isPrimary: makePrimary,
      propertyType: parsed.data.propertyType,
      legacyCustomerId: null,
      lat,
      lng,
    });

    await syncCustomerPrimaryFields(customer._id);
    await assignCustomerOwner(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "address",
      action: "created",
      entityId: String(address._id),
      customerRef: customer._id,
      summary: `Address created for ${custName}`,
      metadata: { label: address.label, customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      address: {
        ...formatAddress(address.toObject()),
        equipment: [],
      },
    });
  } catch (err) {
    console.error("POST /customers/:id/addresses error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/addresses/:addressId
export async function updateCustomerAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addressId = String(req.params.addressId);
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      res.status(400).json({ message: "Invalid address id" });
      return;
    }

    const parsed = updateCustomerAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const address = await CustomerAddress.findOne({
      _id: addressId,
      customerRef: customer._id,
    });
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }

    if (parsed.data.label !== undefined) address.label = parsed.data.label;
    if (parsed.data.address !== undefined)
      address.address = parsed.data.address;
    if (parsed.data.city !== undefined) address.city = parsed.data.city;
    if (parsed.data.state !== undefined) address.state = parsed.data.state;
    if (parsed.data.zip !== undefined) address.zip = parsed.data.zip;

    const addressFieldsChanged =
      parsed.data.address !== undefined ||
      parsed.data.city !== undefined ||
      parsed.data.state !== undefined ||
      parsed.data.zip !== undefined;
    if (addressFieldsChanged && trimStr(address.address)) {
      const geocode = await resolveGeocodedAddress({
        street: trimStr(address.address),
        city: trimStr(address.city),
        state: trimStr(address.state),
        zip: trimStr(address.zip),
      });
      if (geocode.ok) {
        address.lat = geocode.match.coordinates?.lat ?? null;
        address.lng = geocode.match.coordinates?.lng ?? null;
      }
    }
    if (parsed.data.propertyType !== undefined)
      address.propertyType = parsed.data.propertyType;
    if (parsed.data.county !== undefined) {
      address.county = normalizeCountyName(parsed.data.county);
      address.countyManual = true;
    }
    if (parsed.data.countyManual !== undefined) {
      address.countyManual = parsed.data.countyManual;
    }

    if (parsed.data.isPrimary === true) {
      await clearOtherPrimary(
        customer._id,
        address._id as mongoose.Types.ObjectId,
      );
      address.isPrimary = true;
    } else if (parsed.data.isPrimary === false && address.isPrimary) {
      // Keep at least one primary if this is the only address
      const others = await CustomerAddress.countDocuments({
        customerRef: customer._id,
        _id: { $ne: address._id },
      });
      if (others === 0) {
        address.isPrimary = true;
      } else {
        address.isPrimary = false;
        const next = await CustomerAddress.findOne({
          customerRef: customer._id,
          _id: { $ne: address._id },
        }).sort({ createdAt: 1 });
        if (next) {
          next.isPrimary = true;
          await next.save();
        }
      }
    }

    await address.save();
    await syncCustomerPrimaryFields(customer._id);
    await assignCustomerOwner(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "address",
      action: "updated",
      entityId: String(address._id),
      customerRef: customer._id,
      summary: `Address updated for ${custName}`,
      metadata: { label: address.label, customerName: custName },
      ...actorFromRequest(req.user),
    });

    const equipment = await Equipment.find({ addressRef: address._id }).lean();
    res.status(200).json({
      address: {
        ...formatAddress(address.toObject()),
        equipment: equipment.map(formatEquipment),
      },
    });
  } catch (err) {
    console.error("PATCH /customers/:id/addresses/:addressId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id/addresses/:addressId
export async function deleteCustomerAddress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addressId = String(req.params.addressId);
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      res.status(400).json({ message: "Invalid address id" });
      return;
    }

    const address = await CustomerAddress.findOne({
      _id: addressId,
      customerRef: customer._id,
    });
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }

    const woCount = await WorkOrder.countDocuments({ addressRef: address._id });
    const contractCount = await Contract.countDocuments({
      addressRef: address._id,
    });
    if (woCount > 0 || contractCount > 0) {
      res.status(409).json({
        message:
          "Cannot delete address with linked work orders or contracts. Reassign them first.",
        workOrderCount: woCount,
        contractCount,
      });
      return;
    }

    await Equipment.deleteMany({ addressRef: address._id });
    const wasPrimary = address.isPrimary;
    await address.deleteOne();

    if (wasPrimary) {
      const next = await CustomerAddress.findOne({
        customerRef: customer._id,
      }).sort({
        createdAt: 1,
      });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    await syncCustomerPrimaryFields(customer._id);
    await assignCustomerOwner(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "address",
      action: "deleted",
      entityId: addressId,
      customerRef: customer._id,
      summary: `Address deleted for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/addresses/:addressId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/equipment/check-serial
export async function checkEquipmentSerial(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const serial = typeof req.query.serial === "string" ? req.query.serial : "";
    const atsSerial =
      typeof req.query.atsSerial === "string" ? req.query.atsSerial : "";
    const excludeEquipmentId =
      typeof req.query.excludeEquipmentId === "string"
        ? req.query.excludeEquipmentId
        : undefined;

    const { blocking, warnings } = await findSerialConflicts(customer._id, {
      serial,
      atsSerial,
      excludeEquipmentId,
    });
    res.status(200).json({ blocking, warnings });
  } catch (err) {
    console.error("GET /customers/:id/equipment/check-serial error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/equipment
export async function createEquipment(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = createEquipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(parsed.data.addressRef)) {
      res.status(400).json({ message: "Invalid addressRef" });
      return;
    }

    const address = await CustomerAddress.findOne({
      _id: parsed.data.addressRef,
      customerRef: customer._id,
    }).lean();
    if (!address) {
      res.status(404).json({ message: "Address not found for this customer" });
      return;
    }

    const { blocking } = await findSerialConflicts(customer._id, {
      serial: parsed.data.serial,
      atsSerial: parsed.data.atsSerial,
    });
    if (blocking.length > 0) {
      res.status(409).json({
        message: serialConflictMessage(blocking),
        conflicts: blocking,
      });
      return;
    }

    const equipment = await Equipment.create({
      customerRef: customer._id,
      addressRef: address._id,
      generatorModel: parsed.data.generatorModel,
      serial: parsed.data.serial,
      atsSerial: parsed.data.atsSerial,
      lastSvc: parseLastSvc(parsed.data.lastSvc) ?? null,
      exday: parsed.data.exday,
      extime: parsed.data.extime,
    });

    await syncCustomerPrimaryFields(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "equipment",
      action: "created",
      entityId: String(equipment._id),
      customerRef: customer._id,
      summary: `Equipment created for ${custName}`,
      metadata: {
        customerName: custName,
        generatorModel: equipment.generatorModel,
      },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({ equipment: formatEquipment(equipment.toObject()) });
  } catch (err) {
    console.error("POST /customers/:id/equipment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/equipment/:equipmentId
export async function updateEquipment(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const equipmentId = String(req.params.equipmentId);
    if (!mongoose.Types.ObjectId.isValid(equipmentId)) {
      res.status(400).json({ message: "Invalid equipment id" });
      return;
    }

    const parsed = updateEquipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const equipment = await Equipment.findOne({
      _id: equipmentId,
      customerRef: customer._id,
    });
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    const effectiveSerial =
      parsed.data.serial !== undefined ? parsed.data.serial : equipment.serial;
    const effectiveAtsSerial =
      parsed.data.atsSerial !== undefined
        ? parsed.data.atsSerial
        : equipment.atsSerial;
    const { blocking } = await findSerialConflicts(customer._id, {
      serial: effectiveSerial,
      atsSerial: effectiveAtsSerial,
      excludeEquipmentId: equipmentId,
    });
    if (blocking.length > 0) {
      res.status(409).json({
        message: serialConflictMessage(blocking),
        conflicts: blocking,
      });
      return;
    }

    if (parsed.data.addressRef !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(parsed.data.addressRef)) {
        res.status(400).json({ message: "Invalid addressRef" });
        return;
      }
      const address = await CustomerAddress.findOne({
        _id: parsed.data.addressRef,
        customerRef: customer._id,
      }).lean();
      if (!address) {
        res
          .status(404)
          .json({ message: "Address not found for this customer" });
        return;
      }
      equipment.addressRef = address._id as mongoose.Types.ObjectId;
    }

    if (parsed.data.generatorModel !== undefined) {
      equipment.generatorModel = parsed.data.generatorModel;
    }
    if (parsed.data.serial !== undefined) equipment.serial = parsed.data.serial;
    if (parsed.data.atsSerial !== undefined)
      equipment.atsSerial = parsed.data.atsSerial;
    if (parsed.data.lastSvc !== undefined) {
      equipment.lastSvc = parseLastSvc(parsed.data.lastSvc) ?? null;
    }
    if (parsed.data.exday !== undefined) equipment.exday = parsed.data.exday;
    if (parsed.data.extime !== undefined) equipment.extime = parsed.data.extime;

    await equipment.save();
    await syncCustomerPrimaryFields(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "equipment",
      action: "updated",
      entityId: String(equipment._id),
      customerRef: customer._id,
      summary: `Equipment updated for ${custName}`,
      metadata: {
        customerName: custName,
        generatorModel: equipment.generatorModel,
      },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({ equipment: formatEquipment(equipment.toObject()) });
  } catch (err) {
    console.error("PATCH /customers/:id/equipment/:equipmentId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id/equipment/:equipmentId
export async function deleteEquipment(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const equipmentId = String(req.params.equipmentId);
    if (!mongoose.Types.ObjectId.isValid(equipmentId)) {
      res.status(400).json({ message: "Invalid equipment id" });
      return;
    }

    const equipment = await Equipment.findOne({
      _id: equipmentId,
      customerRef: customer._id,
    });
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    const woCount = await WorkOrder.countDocuments({
      equipmentRef: equipment._id,
    });
    if (woCount > 0) {
      res.status(409).json({
        message:
          "Cannot delete equipment linked to work orders. Reassign them first.",
        workOrderCount: woCount,
      });
      return;
    }

    await equipment.deleteOne();
    await syncCustomerPrimaryFields(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "equipment",
      action: "deleted",
      entityId: equipmentId,
      customerRef: customer._id,
      summary: `Equipment deleted for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/equipment/:equipmentId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/contacts
export async function getCustomerContacts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    await ensureCustomerContactFromFlat(customer);
    const contacts = await loadContactsForCustomer(customer._id);
    res.status(200).json({ contacts });
  } catch (err) {
    console.error("GET /customers/:id/contacts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/contacts
export async function createCustomerContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const parsed = createCustomerContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const existingCount = await CustomerContact.countDocuments({
      customerRef: customer._id,
    });
    const makePrimary = parsed.data.isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await clearOtherPrimaryContacts(customer._id);
    }

    const contact = await CustomerContact.create({
      customerRef: customer._id,
      first: parsed.data.first,
      last: parsed.data.last,
      phone: parsed.data.phone,
      email: parsed.data.email,
      label: parsed.data.label,
      isPrimary: makePrimary,
      legacyCustomerId: null,
    });

    await ensureCustomerUser(contact);
    const refreshed = await CustomerContact.findById(contact._id);
    await syncCustomerPrimaryContactFields(customer._id);

    const custName = customerDisplayName(customer);
    const contactName = `${contact.first} ${contact.last}`.trim() || "Contact";
    logNotificationAsync({
      entityType: "contact",
      action: "created",
      entityId: String(contact._id),
      customerRef: customer._id,
      summary: `Contact ${contactName} created for ${custName}`,
      metadata: { customerName: custName, contactName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      contact: formatContact((refreshed ?? contact).toObject()),
    });
  } catch (err) {
    console.error("POST /customers/:id/contacts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /customers/:id/contacts/:contactId
export async function updateCustomerContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const contactId = String(req.params.contactId);
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }

    const parsed = updateCustomerContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const contact = await CustomerContact.findOne({
      _id: contactId,
      customerRef: customer._id,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    if (parsed.data.first !== undefined) contact.first = parsed.data.first;
    if (parsed.data.last !== undefined) contact.last = parsed.data.last;
    if (parsed.data.phone !== undefined) contact.phone = parsed.data.phone;
    if (parsed.data.email !== undefined) contact.email = parsed.data.email;
    if (parsed.data.label !== undefined) contact.label = parsed.data.label;

    if (parsed.data.isPrimary === true) {
      await clearOtherPrimaryContacts(
        customer._id,
        contact._id as mongoose.Types.ObjectId,
      );
      contact.isPrimary = true;
    } else if (parsed.data.isPrimary === false && contact.isPrimary) {
      const others = await CustomerContact.countDocuments({
        customerRef: customer._id,
        _id: { $ne: contact._id },
      });
      if (others === 0) {
        contact.isPrimary = true;
      } else {
        contact.isPrimary = false;
        const next = await CustomerContact.findOne({
          customerRef: customer._id,
          _id: { $ne: contact._id },
        }).sort({ createdAt: 1 });
        if (next) {
          next.isPrimary = true;
          await next.save();
        }
      }
    }

    await contact.save();
    await ensureCustomerUser(contact);
    const refreshed = await CustomerContact.findById(contact._id);
    await syncCustomerPrimaryContactFields(customer._id);

    const custName = customerDisplayName(customer);
    const contactName = `${contact.first} ${contact.last}`.trim() || "Contact";
    logNotificationAsync({
      entityType: "contact",
      action: "updated",
      entityId: String(contact._id),
      customerRef: customer._id,
      summary: `Contact ${contactName} updated for ${custName}`,
      metadata: { customerName: custName, contactName },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      contact: formatContact((refreshed ?? contact).toObject()),
    });
  } catch (err) {
    console.error("PATCH /customers/:id/contacts/:contactId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /customers/:id/contacts/:contactId
export async function deleteCustomerContact(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const customer = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!customer) return;
    if (customer.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const contactId = String(req.params.contactId);
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contact id" });
      return;
    }

    const contact = await CustomerContact.findOne({
      _id: contactId,
      customerRef: customer._id,
    });
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    const total = await CustomerContact.countDocuments({
      customerRef: customer._id,
    });
    if (total <= 1) {
      res.status(409).json({
        message: "Cannot delete the last contact on a customer.",
      });
      return;
    }

    const wasPrimary = contact.isPrimary;
    await contact.deleteOne();

    if (wasPrimary) {
      const next = await CustomerContact.findOne({
        customerRef: customer._id,
      }).sort({ createdAt: 1 });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    await syncCustomerPrimaryContactFields(customer._id);

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "contact",
      action: "deleted",
      entityId: contactId,
      customerRef: customer._id,
      summary: `Contact deleted for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/contacts/:contactId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// GET /customers/:id/merge-preview?sourceCustomerId=
export async function getMergePreview(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const survivor = await findActiveCustomerOr404(
      String(req.params.id),
      res,
      req.user,
    );
    if (!survivor) return;
    if (survivor.mergedIntoRef) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const sourceCustomerId = String(req.query.sourceCustomerId ?? "");
    const source = await findActiveCustomerOr404(
      sourceCustomerId,
      res,
      req.user,
    );
    if (!source) return;

    if (survivor._id.equals(source._id)) {
      res.status(400).json({ message: "Cannot merge a customer into itself" });
      return;
    }
    if (source.mergedIntoRef) {
      res.status(400).json({ message: "Source customer was already merged" });
      return;
    }

    await ensureCustomerSiteFromFlat(source);
    await ensureCustomerSiteFromFlat(survivor);
    await ensureCustomerContactFromFlat(source);
    await ensureCustomerContactFromFlat(survivor);

    const [
      survivorAddresses,
      sourceAddresses,
      survivorEquipment,
      sourceEquipment,
      survivorContacts,
      sourceContacts,
      survivorWos,
      sourceWos,
      survivorContracts,
      sourceContracts,
      survivorNoteCount,
      sourceNoteCount,
    ] = await Promise.all([
      CustomerAddress.find({ customerRef: survivor._id })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean(),
      CustomerAddress.find({ customerRef: source._id })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean(),
      Equipment.find({ customerRef: survivor._id }).lean(),
      Equipment.find({ customerRef: source._id }).lean(),
      CustomerContact.find({ customerRef: survivor._id })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean(),
      CustomerContact.find({ customerRef: source._id })
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean(),
      WorkOrder.find({ customerId: survivor.legacyId })
        .select("_id addressRef")
        .lean(),
      WorkOrder.find({ customerId: source.legacyId })
        .select("_id addressRef")
        .lean(),
      Contract.find({ customerId: survivor.legacyId })
        .select(
          "_id description contractType templateId renewalDueDate addressRef equipmentRef",
        )
        .lean(),
      Contract.find({ customerId: source.legacyId })
        .select(
          "_id description contractType templateId renewalDueDate addressRef equipmentRef",
        )
        .lean(),
      CustomerNote.countDocuments({ customerRef: survivor._id }),
      CustomerNote.countDocuments({ customerRef: source._id }),
    ]);

    const templateIds = [
      ...new Set(
        [...survivorContracts, ...sourceContracts]
          .map((c) => c.templateId?.toString())
          .filter(Boolean) as string[],
      ),
    ];
    const templates =
      templateIds.length > 0
        ? await ContractTemplate.find({ _id: { $in: templateIds } })
            .select("_id label slug")
            .lean()
        : [];
    const templateById = new Map(
      templates.map((t) => [
        t._id.toString(),
        { label: t.label, slug: t.slug },
      ]),
    );

    const equipmentByAddress = new Map<
      string,
      ReturnType<typeof formatEquipment>[]
    >();
    for (const eq of [...survivorEquipment, ...sourceEquipment]) {
      const key = eq.addressRef.toString();
      const list = equipmentByAddress.get(key) ?? [];
      list.push(formatEquipment(eq));
      equipmentByAddress.set(key, list);
    }

    function formatContractSummary(c: {
      _id: mongoose.Types.ObjectId;
      description?: string;
      contractType?: string | null;
      templateId?: mongoose.Types.ObjectId | null;
      renewalDueDate?: Date | null;
      addressRef?: mongoose.Types.ObjectId | null;
      equipmentRef?: mongoose.Types.ObjectId | null;
    }) {
      const template = c.templateId
        ? templateById.get(c.templateId.toString())
        : null;
      const standing = getContractStanding(c.renewalDueDate ?? null);
      const equipment =
        c.equipmentRef != null
          ? [...survivorEquipment, ...sourceEquipment].find(
              (e) => e._id.toString() === c.equipmentRef!.toString(),
            )
          : null;
      const equipmentLabel = equipment
        ? [equipment.generatorModel, equipment.serial]
            .filter(Boolean)
            .join(" · ") || "Equipment"
        : null;

      return {
        _id: c._id.toString(),
        description: c.description ?? "",
        contractType: c.contractType ?? null,
        templateLabel: template?.label ?? null,
        templateSlug: template?.slug ?? null,
        renewalDueDate: c.renewalDueDate
          ? c.renewalDueDate.toISOString()
          : null,
        standing,
        equipmentLabel,
      };
    }

    function countWosForAddress(
      addressId: mongoose.Types.ObjectId,
      wos: Array<{ addressRef?: mongoose.Types.ObjectId | null }>,
      allAddressesForCustomer: unknown[],
      nullAddressWos: number,
    ): number {
      const tagged = wos.filter(
        (w) => w.addressRef?.toString() === addressId.toString(),
      ).length;
      // Merge tags null-address WOs onto the sole address when customer has exactly one
      if (allAddressesForCustomer.length === 1) {
        return tagged + nullAddressWos;
      }
      return tagged;
    }

    function contractsForAddress(
      addressId: mongoose.Types.ObjectId,
      contracts: typeof survivorContracts,
      allAddressesForCustomer: unknown[],
      nullAddressContracts: typeof survivorContracts,
    ) {
      const tagged = contracts.filter(
        (c) => c.addressRef?.toString() === addressId.toString(),
      );
      if (allAddressesForCustomer.length === 1) {
        return [...tagged, ...nullAddressContracts].map(formatContractSummary);
      }
      return tagged.map(formatContractSummary);
    }

    const survivorNullWos = survivorWos.filter((w) => !w.addressRef).length;
    const sourceNullWos = sourceWos.filter((w) => !w.addressRef).length;
    const survivorNullContracts = survivorContracts.filter(
      (c) => !c.addressRef,
    );
    const sourceNullContracts = sourceContracts.filter((c) => !c.addressRef);

    const allocation = [
      ...survivorAddresses.map((addr) => ({
        origin: "survivor" as const,
        _id: addr._id.toString(),
        label: addr.label ?? "",
        address: addr.address ?? "",
        city: addr.city ?? "",
        state: addr.state ?? "",
        zip: addr.zip ?? "",
        // Survivor keeps primary as-is
        isPrimary: Boolean(addr.isPrimary),
        equipment: equipmentByAddress.get(addr._id.toString()) ?? [],
        workOrderCount: countWosForAddress(
          addr._id as mongoose.Types.ObjectId,
          survivorWos,
          survivorAddresses,
          survivorNullWos,
        ),
        contracts: contractsForAddress(
          addr._id as mongoose.Types.ObjectId,
          survivorContracts,
          survivorAddresses,
          survivorNullContracts,
        ),
      })),
      ...sourceAddresses.map((addr) => ({
        origin: "source" as const,
        _id: addr._id.toString(),
        label: addr.label ?? "",
        address: addr.address ?? "",
        city: addr.city ?? "",
        state: addr.state ?? "",
        zip: addr.zip ?? "",
        // Source primaries become non-primary on merge
        isPrimary: false,
        equipment: equipmentByAddress.get(addr._id.toString()) ?? [],
        workOrderCount: countWosForAddress(
          addr._id as mongoose.Types.ObjectId,
          sourceWos,
          sourceAddresses,
          sourceNullWos,
        ),
        contracts: contractsForAddress(
          addr._id as mongoose.Types.ObjectId,
          sourceContracts,
          sourceAddresses,
          sourceNullContracts,
        ),
      })),
    ];

    // Unassigned only when null-address records won't be auto-tagged (multi-address side)
    const unassigned = {
      survivor: {
        workOrderCount: survivorAddresses.length === 1 ? 0 : survivorNullWos,
        contracts:
          survivorAddresses.length === 1
            ? []
            : survivorNullContracts.map(formatContractSummary),
      },
      source: {
        workOrderCount: sourceAddresses.length === 1 ? 0 : sourceNullWos,
        contracts:
          sourceAddresses.length === 1
            ? []
            : sourceNullContracts.map(formatContractSummary),
      },
    };

    const contacts = [
      ...survivorContacts.map((c) => ({
        origin: "survivor" as const,
        ...formatContact(c),
        // Survivor primary stays primary by default after merge
        isPrimary: Boolean(c.isPrimary),
      })),
      ...sourceContacts.map((c) => ({
        origin: "source" as const,
        ...formatContact(c),
        // Source primaries become non-primary unless user picks them
        isPrimary: false,
      })),
    ];

    const defaultPrimaryContactId =
      survivorContacts.find((c) => c.isPrimary)?._id.toString() ??
      survivorContacts[0]?._id.toString() ??
      sourceContacts[0]?._id.toString() ??
      null;

    const totals = {
      addresses: survivorAddresses.length + sourceAddresses.length,
      equipment: survivorEquipment.length + sourceEquipment.length,
      workOrders: survivorWos.length + sourceWos.length,
      contracts: survivorContracts.length + sourceContracts.length,
      notes: survivorNoteCount + sourceNoteCount,
      contacts: survivorContacts.length + sourceContacts.length,
    };

    res.status(200).json({
      survivor: {
        _id: survivor._id.toString(),
        legacyId: survivor.legacyId,
        accountName: survivor.accountName ?? "",
        first: survivor.first,
        last: survivor.last,
        phone: survivor.phone,
        email: survivor.email,
      },
      source: {
        _id: source._id.toString(),
        legacyId: source.legacyId,
        accountName: source.accountName ?? "",
        first: source.first,
        last: source.last,
        phone: source.phone,
        email: source.email,
      },
      contacts,
      defaultPrimaryContactId,
      allocation,
      unassigned,
      totals,
      contractsFromBothSides:
        survivorContracts.length > 0 && sourceContracts.length > 0,
    });
  } catch (err) {
    console.error("GET /customers/:id/merge-preview error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /customers/:id/merge
export async function mergeCustomers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const survivorId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(survivorId)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }

    const parsed = mergeCustomersSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const { sourceCustomerId, primaryContactId } = parsed.data;
    if (!mongoose.Types.ObjectId.isValid(sourceCustomerId)) {
      res.status(400).json({ message: "Invalid sourceCustomerId" });
      return;
    }

    if (survivorId === sourceCustomerId) {
      res.status(400).json({ message: "Cannot merge a customer into itself" });
      return;
    }

    if (
      primaryContactId !== undefined &&
      !mongoose.Types.ObjectId.isValid(primaryContactId)
    ) {
      res.status(400).json({ message: "Invalid primaryContactId" });
      return;
    }

    const survivor = await Customer.findById(survivorId);
    const source = await Customer.findById(sourceCustomerId);

    if (!survivor || !source) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    if (survivor.mergedIntoRef || source.mergedIntoRef) {
      res
        .status(400)
        .json({ message: "One of the customers was already merged" });
      return;
    }

    await ensureCustomerSiteFromFlat(source);
    await ensureCustomerSiteFromFlat(survivor);
    await ensureCustomerContactFromFlat(source);
    await ensureCustomerContactFromFlat(survivor);

    if (primaryContactId) {
      const chosen = await CustomerContact.findOne({
        _id: primaryContactId,
        customerRef: { $in: [survivor._id, source._id] },
      })
        .select("_id")
        .lean();
      if (!chosen) {
        res.status(400).json({
          message:
            "primaryContactId must belong to the survivor or source customer",
        });
        return;
      }
    }

    // Tag source WOs/contracts to the source's sole address before remapping
    // customerId, so addressRef survives the merge.
    const sourceAddresses = await CustomerAddress.find({
      customerRef: source._id,
    })
      .select("_id")
      .lean();

    if (sourceAddresses.length === 1) {
      const sourceAddressId = sourceAddresses[0]._id;
      const sourceEquipment = await Equipment.find({
        addressRef: sourceAddressId,
      })
        .select("_id")
        .lean();
      const sourceEquipmentId =
        sourceEquipment.length === 1 ? sourceEquipment[0]._id : null;

      const tagFields: Record<string, unknown> = {
        addressRef: sourceAddressId,
        customerRef: source._id,
      };
      if (sourceEquipmentId) {
        tagFields.equipmentRef = sourceEquipmentId;
      }

      await WorkOrder.updateMany(
        {
          customerId: source.legacyId,
          $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
        },
        { $set: tagFields },
      );
      await Contract.updateMany(
        {
          customerId: source.legacyId,
          $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
        },
        { $set: tagFields },
      );
    }

    // Source addresses become non-primary on survivor (survivor keeps its primary)
    await CustomerAddress.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id, isPrimary: false } },
    );

    await Equipment.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id } },
    );

    await WorkOrder.updateMany(
      { customerId: source.legacyId },
      {
        $set: {
          customerId: survivor.legacyId,
          customerRef: survivor._id,
        },
      },
    );

    await Contract.updateMany(
      { customerId: source.legacyId },
      {
        $set: {
          customerId: survivor.legacyId,
          customerRef: survivor._id,
        },
      },
    );

    await CustomerNote.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id } },
    );

    // Source contacts move onto survivor; primaries cleared until we set one.
    await CustomerContact.updateMany(
      { customerRef: source._id },
      { $set: { customerRef: survivor._id, isPrimary: false } },
    );

    if (primaryContactId) {
      await clearOtherPrimaryContacts(
        survivor._id as mongoose.Types.ObjectId,
        new mongoose.Types.ObjectId(primaryContactId),
      );
      await CustomerContact.updateOne(
        { _id: primaryContactId, customerRef: survivor._id },
        { $set: { isPrimary: true } },
      );
    }

    source.mergedIntoRef = survivor._id as mongoose.Types.ObjectId;
    source.mergedAt = new Date();
    await source.save();

    await syncCustomerPrimaryFields(survivor._id);
    await assignCustomerOwner(survivor._id);
    await syncCustomerPrimaryContactFields(survivor._id);

    const [addresses, contacts, refreshed] = await Promise.all([
      loadSitesForCustomer(survivor._id as mongoose.Types.ObjectId),
      loadContactsForCustomer(survivor._id as mongoose.Types.ObjectId),
      Customer.findById(survivor._id).lean(),
    ]);

    const survivorName = customerDisplayName(survivor);
    const sourceName = customerDisplayName(source);
    logNotificationAsync({
      entityType: "customer",
      action: "merged",
      entityId: String(survivor._id),
      customerRef: survivor._id,
      summary: `Customer ${sourceName} merged into ${survivorName}`,
      metadata: {
        customerName: survivorName,
        sourceCustomerId: String(source._id),
        sourceCustomerName: sourceName,
      },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      customer: {
        ...refreshed,
        _id: refreshed!._id.toString(),
        lastSvc: refreshed!.lastSvc ? refreshed!.lastSvc.toISOString() : null,
        mergedIntoRef: null,
        addresses,
        contacts,
      },
      mergedSourceId: source._id.toString(),
    });
  } catch (err) {
    console.error("POST /customers/:id/merge error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
