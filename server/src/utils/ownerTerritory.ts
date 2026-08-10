import { Types } from "mongoose";
import {
  FLORIDA_COUNTIES,
  normalizeCountyName,
} from "../constants/floridaCounties";
import { countyForFloridaZip } from "../constants/floridaZipCounties";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { User, activeUserFilter } from "../models/mongo/User";
import { lookupCountyFromCensus } from "./censusGeocoder";
import { syncCustomerPrimaryFields } from "./customerSites";

export type LocationForOwner = {
  county?: string | null;
  zip?: string | null;
  state?: string | null;
};

/** Cache Census county lookups for a process lifetime (keyed by street|city|state|zip). */
const countyLookupCache = new Map<string, string>();

export function normalizeZip5(zip: string | null | undefined): string {
  const digits = (zip ?? "").replace(/\D/g, "");
  return digits.slice(0, 5);
}

type TerritoryIndex = {
  byZip: Map<string, Types.ObjectId>;
  byCounty: Map<string, Types.ObjectId>;
};

/** In-memory owner territory maps for bulk reassignment (avoids per-customer User queries). */
let territoryIndex: TerritoryIndex | null = null;

async function buildTerritoryIndex(): Promise<TerritoryIndex> {
  const owners = await User.find({
    ...activeUserFilter,
    role: "owner",
  })
    .select("_id territories")
    .lean();

  const byZip = new Map<string, Types.ObjectId>();
  const byCounty = new Map<string, Types.ObjectId>();
  for (const owner of owners) {
    const id = owner._id as Types.ObjectId;
    for (const zip of owner.territories?.zips ?? []) {
      const z = normalizeZip5(zip);
      if (z && !byZip.has(z)) byZip.set(z, id);
    }
    for (const county of owner.territories?.counties ?? []) {
      const c = normalizeCountyName(county);
      if (c && !byCounty.has(c)) byCounty.set(c, id);
    }
  }
  return { byZip, byCounty };
}

/** Zip match wins; otherwise FL county match. */
export async function resolveOwnerForLocation(
  loc: LocationForOwner,
): Promise<Types.ObjectId | null> {
  const zip = normalizeZip5(loc.zip);
  const state = (loc.state ?? "").trim().toUpperCase().slice(0, 2);
  const county = normalizeCountyName(loc.county);

  if (territoryIndex) {
    if (zip) {
      const byZip = territoryIndex.byZip.get(zip);
      if (byZip) return byZip;
    }
    // County match: allow wrong/missing state when we already have a FL county name.
    if (county && (state === "FL" || !state || territoryIndex.byCounty.has(county))) {
      const byCounty = territoryIndex.byCounty.get(county);
      if (byCounty) return byCounty;
    }
    return null;
  }

  if (zip) {
    const byZip = await User.findOne({
      ...activeUserFilter,
      role: "owner",
      "territories.zips": zip,
    })
      .select("_id")
      .lean();
    if (byZip) return byZip._id as Types.ObjectId;
  }

  if (county && (state === "FL" || !state)) {
    const byCounty = await User.findOne({
      ...activeUserFilter,
      role: "owner",
      "territories.counties": county,
    })
      .select("_id")
      .lean();
    if (byCounty) return byCounty._id as Types.ObjectId;
  }

  return null;
}

/**
 * Resolve county for an address.
 * Prefer FL ZIP→county (fast/reliable for this CRM), then Census street geocode.
 */
async function resolveCountyForAddress(
  addr: {
    _id: Types.ObjectId;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    countyManual?: boolean;
  },
  options?: { allowCensus?: boolean },
): Promise<string> {
  const existing = normalizeCountyName(addr.county);
  if (existing) return existing;
  if (addr.countyManual) return "";

  const state = (addr.state ?? "").trim().toUpperCase().slice(0, 2) || "FL";
  const zip = normalizeZip5(addr.zip);
  const street = (addr.address ?? "").trim();
  const city = (addr.city ?? "").trim();
  const allowCensus = options?.allowCensus !== false;

  // Prefer FL ZIP map whenever the ZIP is known — state is often wrong/missing
  // in imported data (e.g. "DL" for DeLand).
  let county = "";
  if (zip) {
    county = normalizeCountyName(countyForFloridaZip(zip));
  }

  if (!county && allowCensus && street) {
    const cacheKey = `${street}|${city}|${state}|${zip}`.toLowerCase();
    let lookedUp = countyLookupCache.get(cacheKey);
    if (lookedUp === undefined) {
      lookedUp = await lookupCountyFromCensus({
        street,
        city,
        state,
        zip,
      });
      countyLookupCache.set(cacheKey, lookedUp);
    }
    county = lookedUp;
  }

  if (county) {
    await CustomerAddress.updateOne(
      { _id: addr._id, countyManual: { $ne: true } },
      { $set: { county } },
    );
  }

  return county;
}

/** Set/clear customer.ownerUserRef from primary address location. */
export async function assignCustomerOwner(
  customerId: Types.ObjectId | string,
  options?: { fillMissingCounty?: boolean; allowCensus?: boolean },
): Promise<Types.ObjectId | null> {
  const fillMissingCounty = options?.fillMissingCounty !== false;
  const allowCensus = options?.allowCensus !== false;

  const primary =
    (await CustomerAddress.findOne({
      customerRef: customerId,
      isPrimary: true,
    }).lean()) ??
    (await CustomerAddress.findOne({ customerRef: customerId })
      .sort({ createdAt: 1 })
      .lean());

  // Fall back to denormalized customer fields when no address doc exists.
  const customer = await Customer.findById(customerId)
    .select("county zip state address city ownerUserRef")
    .lean();

  let county = normalizeCountyName(primary?.county || customer?.county);
  const zip = normalizeZip5(primary?.zip || customer?.zip);
  const state = (primary?.state || customer?.state || "FL")
    .trim()
    .toUpperCase()
    .slice(0, 2);

  if (fillMissingCounty && !county) {
    if (primary) {
      county = await resolveCountyForAddress(primary, { allowCensus });
      if (county) {
        await syncCustomerPrimaryFields(customerId);
      }
    } else if (zip) {
      county = normalizeCountyName(countyForFloridaZip(zip));
      if (county) {
        await Customer.findByIdAndUpdate(customerId, { $set: { county } });
      }
    } else if (allowCensus && customer?.address?.trim()) {
      const cacheKey =
        `${customer.address}|${customer.city ?? ""}|${state}|${zip}`.toLowerCase();
      let lookedUp = countyLookupCache.get(cacheKey);
      if (lookedUp === undefined) {
        lookedUp = await lookupCountyFromCensus({
          street: customer.address,
          city: customer.city,
          state,
          zip,
        });
        countyLookupCache.set(cacheKey, lookedUp);
      }
      county = lookedUp;
      if (county) {
        await Customer.findByIdAndUpdate(customerId, { $set: { county } });
      }
    }
  }

  // Last resort: ZIP map even when fill path above only had empty street geocode.
  if (fillMissingCounty && !county && zip) {
    county = normalizeCountyName(countyForFloridaZip(zip));
    if (county) {
      if (primary) {
        await CustomerAddress.updateOne(
          { _id: primary._id, countyManual: { $ne: true } },
          { $set: { county } },
        );
        await syncCustomerPrimaryFields(customerId);
      } else {
        await Customer.findByIdAndUpdate(customerId, { $set: { county } });
      }
    }
  }

  const ownerId = await resolveOwnerForLocation({ county, zip, state });
  const prevOwner = customer?.ownerUserRef
    ? String(customer.ownerUserRef)
    : "";
  const nextOwner = ownerId ? String(ownerId) : "";
  if (prevOwner !== nextOwner) {
    await Customer.findByIdAndUpdate(customerId, {
      $set: { ownerUserRef: ownerId },
    });
  }

  return ownerId;
}

const notMergedFilter = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

/**
 * Reassign owners for customers affected by a territory change.
 * When `allCustomers` is true (default for territory saves), every active
 * customer is re-evaluated so missing county data can be filled and assigned.
 */
/**
 * Fire-and-forget ownership recalculation.
 * Fast pass uses FL ZIP→county (no network); optional Census pass fills gaps.
 */
export function scheduleOwnerReassignment(label = "territory"): void {
  void reassignOwnersForTerritoryChange({
    allCustomers: true,
    fillMissingCounty: true,
    allowCensus: false,
  })
    .then((fast) => {
      console.log(
        `[territory] ${label} ZIP reassignment: processed=${fast.processed} assigned=${fast.assigned}`,
      );
      return reassignOwnersForTerritoryChange({
        allCustomers: true,
        fillMissingCounty: true,
        allowCensus: true,
      });
    })
    .then((full) => {
      console.log(
        `[territory] ${label} Census reassignment: processed=${full.processed} assigned=${full.assigned}`,
      );
    })
    .catch((err) => {
      console.error(`[territory] ${label} reassignment failed:`, err);
    });
}

export async function reassignOwnersForTerritoryChange(options: {
  counties?: string[];
  zips?: string[];
  previousOwnerId?: Types.ObjectId | string | null;
  allCustomers?: boolean;
  fillMissingCounty?: boolean;
  allowCensus?: boolean;
}): Promise<{ processed: number; assigned: number }> {
  const fillMissingCounty = options.fillMissingCounty !== false;
  const allowCensus = options.allowCensus !== false;
  const allCustomers = options.allCustomers === true;

  let customerIds: Types.ObjectId[];

  if (allCustomers) {
    const customers = await Customer.find({
      deletedAt: null,
      ...notMergedFilter,
    })
      .select("_id")
      .lean();
    customerIds = customers.map((c) => c._id as Types.ObjectId);
  } else {
    const counties = (options.counties ?? [])
      .map((c) => normalizeCountyName(c))
      .filter(Boolean);
    const zips = (options.zips ?? []).map(normalizeZip5).filter(Boolean);

    const or: Array<Record<string, unknown>> = [];
    if (counties.length) or.push({ county: { $in: counties } });
    if (zips.length) or.push({ zip: { $in: zips } });
    if (options.previousOwnerId) {
      or.push({ ownerUserRef: options.previousOwnerId });
    }

    // Also pick up customers whose site address has the county/zip even if
    // denormalized Customer.county was never synced.
    if (counties.length || zips.length) {
      const addressOr: Array<Record<string, unknown>> = [];
      if (counties.length) addressOr.push({ county: { $in: counties } });
      if (zips.length) addressOr.push({ zip: { $in: zips } });
      const addressHits = await CustomerAddress.find({ $or: addressOr })
        .select("customerRef")
        .lean();
      for (const a of addressHits) {
        or.push({ _id: a.customerRef });
      }
    }

    if (or.length === 0) return { processed: 0, assigned: 0 };

    const customers = await Customer.find({
      deletedAt: null,
      ...notMergedFilter,
      $or: or,
    })
      .select("_id")
      .lean();
    customerIds = customers.map((c) => c._id as Types.ObjectId);
  }

  territoryIndex = await buildTerritoryIndex();
  let assigned = 0;
  try {
    for (let i = 0; i < customerIds.length; i += 1) {
      const id = customerIds[i]!;
      const ownerId = await assignCustomerOwner(id, {
        fillMissingCounty,
        allowCensus,
      });
      if (ownerId) assigned += 1;
      if ((i + 1) % 500 === 0) {
        console.log(
          `[territory] reassignment progress ${i + 1}/${customerIds.length} (assigned=${assigned})`,
        );
      }
    }
  } finally {
    territoryIndex = null;
  }
  return { processed: customerIds.length, assigned };
}

export type TerritoryConflict = {
  type: "county" | "zip";
  value: string;
  ownerId: string;
  ownerName: string;
};

/** Find counties/zips already claimed by other active owners. */
export async function findTerritoryConflicts(
  territories: { counties: string[]; zips: string[] },
  excludeUserId?: Types.ObjectId | string | null,
): Promise<TerritoryConflict[]> {
  const counties = territories.counties
    .map((c) => normalizeCountyName(c))
    .filter(Boolean);
  const zips = territories.zips.map(normalizeZip5).filter(Boolean);
  if (counties.length === 0 && zips.length === 0) return [];

  const filter: Record<string, unknown> = {
    ...activeUserFilter,
    role: "owner",
    $or: [
      ...(counties.length ? [{ "territories.counties": { $in: counties } }] : []),
      ...(zips.length ? [{ "territories.zips": { $in: zips } }] : []),
    ],
  };
  if (excludeUserId) {
    filter._id = { $ne: excludeUserId };
  }

  const owners = await User.find(filter)
    .select("_id first_name last_name territories")
    .lean();

  const conflicts: TerritoryConflict[] = [];
  const countySet = new Set(counties);
  const zipSet = new Set(zips);

  for (const owner of owners) {
    const name = `${owner.first_name} ${owner.last_name}`.trim();
    const id = String(owner._id);
    for (const c of owner.territories?.counties ?? []) {
      if (countySet.has(c)) {
        conflicts.push({
          type: "county",
          value: c,
          ownerId: id,
          ownerName: name,
        });
      }
    }
    for (const z of owner.territories?.zips ?? []) {
      if (zipSet.has(z)) {
        conflicts.push({
          type: "zip",
          value: z,
          ownerId: id,
          ownerName: name,
        });
      }
    }
  }

  return conflicts;
}

export function emptyTerritories(): { counties: string[]; zips: string[] } {
  return { counties: [], zips: [] };
}

export function normalizeTerritoriesInput(raw: {
  counties?: string[] | null;
  zips?: string[] | null;
}): { counties: string[]; zips: string[] } {
  const counties = [
    ...new Set(
      (raw.counties ?? [])
        .map((c) => normalizeCountyName(c))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const zips = [
    ...new Set(
      (raw.zips ?? [])
        .map(normalizeZip5)
        .filter((z) => z.length === 5),
    ),
  ].sort();
  return { counties, zips };
}

function ownerHasStatewideCounties(counties: string[]): boolean {
  if (counties.length < FLORIDA_COUNTIES.length) return false;
  const set = new Set(counties.map((c) => normalizeCountyName(c)));
  return FLORIDA_COUNTIES.every((c) => set.has(c));
}

/** Include common stored variants ("Orange" / "Orange County"). */
function countyQueryValues(counties: string[]): string[] {
  const values = new Set<string>();
  for (const raw of counties) {
    const c = normalizeCountyName(raw);
    if (!c) continue;
    values.add(c);
    values.add(`${c} County`);
    values.add(c.toUpperCase());
    values.add(`${c.toUpperCase()} COUNTY`);
  }
  return [...values];
}

async function zipsClaimedByOtherOwners(
  excludeUserId: Types.ObjectId | string,
): Promise<string[]> {
  const others = await User.find({
    ...activeUserFilter,
    role: "owner",
    _id: { $ne: excludeUserId },
    "territories.zips.0": { $exists: true },
  })
    .select("territories.zips")
    .lean();

  const zips = new Set<string>();
  for (const o of others) {
    for (const z of o.territories?.zips ?? []) {
      const zip = normalizeZip5(z);
      if (zip) zips.add(zip);
    }
  }
  return [...zips];
}

const unassignedOwnerClause = {
  $or: [{ ownerUserRef: null }, { ownerUserRef: { $exists: false } }],
};

/**
 * Mongo filter for customer lists / search.
 * Admin, super-admin, and owner are org-wide (null = no territory clause).
 * Territory still drives assignCustomerOwner / reassignment elsewhere.
 *
 * Legacy owner-scoped branch below is unused while owner is unrestricted;
 * kept for reference if list visibility is re-scoped later.
 * Matches assigned owner OR (unassigned + location in territory).
 * Statewide owners (all 67 FL counties) also see unassigned customers with
 * missing county data — otherwise most legacy records are invisible.
 */
export async function buildOwnerCustomerFilter(user: {
  id: string;
  role: string;
}): Promise<Record<string, unknown> | null> {
  if (
    user.role === "super-admin" ||
    user.role === "admin" ||
    user.role === "owner"
  ) {
    return null;
  }
  if (user.role !== "owner") return null;

  const ownerId = new Types.ObjectId(user.id);
  const owner = await User.findById(ownerId).select("territories").lean();
  const counties = (owner?.territories?.counties ?? []).map(normalizeCountyName);
  const zips = (owner?.territories?.zips ?? []).map(normalizeZip5).filter(Boolean);
  const otherZips = await zipsClaimedByOtherOwners(ownerId);

  if (counties.length === 0 && zips.length === 0) {
    return { ownerUserRef: ownerId };
  }

  const notOtherZip =
    otherZips.length > 0
      ? {
          $or: [
            { zip: { $nin: otherZips } },
            { zip: null },
            { zip: "" },
            { zip: { $exists: false } },
          ],
        }
      : null;

  // Owner claimed every FL county — treat as statewide coverage.
  if (ownerHasStatewideCounties(counties)) {
    const unassignedAndAvailable: Record<string, unknown>[] = [
      unassignedOwnerClause,
    ];
    if (notOtherZip) unassignedAndAvailable.push(notOtherZip);

    return {
      $or: [
        { ownerUserRef: ownerId },
        { $and: unassignedAndAvailable },
      ],
    };
  }

  const locationClauses: Array<Record<string, unknown>> = [];
  const countyValues = countyQueryValues(counties);
  if (countyValues.length) {
    locationClauses.push({ county: { $in: countyValues } });
  }
  if (zips.length) locationClauses.push({ zip: { $in: zips } });

  if (locationClauses.length === 0) {
    return { ownerUserRef: ownerId };
  }

  return {
    $or: [
      { ownerUserRef: ownerId },
      {
        $and: [unassignedOwnerClause, { $or: locationClauses }],
      },
    ],
  };
}

export async function assertOwnerCanAccessCustomer(
  user: { id: string; role: string },
  customer: {
    ownerUserRef?: Types.ObjectId | string | null;
    county?: string | null;
    zip?: string | null;
    state?: string | null;
  },
): Promise<boolean> {
  if (
    user.role === "super-admin" ||
    user.role === "admin" ||
    user.role === "owner"
  ) {
    return true;
  }
  if (user.role !== "owner") return true;

  const ref = customer.ownerUserRef;
  if (ref && String(ref) === user.id) return true;
  if (ref && String(ref) !== user.id) return false;

  const owner = await User.findById(user.id).select("territories").lean();
  const counties = (owner?.territories?.counties ?? []).map(normalizeCountyName);
  const zips = (owner?.territories?.zips ?? []).map(normalizeZip5);
  const county = normalizeCountyName(customer.county);
  const zip = normalizeZip5(customer.zip);

  const otherZips = await zipsClaimedByOtherOwners(user.id);
  if (zip && otherZips.includes(zip)) return false;

  if (zip && zips.includes(zip)) return true;
  if (county && counties.includes(county)) return true;

  // Statewide owners can open unassigned customers even before county backfill.
  if (ownerHasStatewideCounties(counties)) return true;

  return false;
}
