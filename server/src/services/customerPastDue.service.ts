import { Types } from "mongoose";
import { WorkOrder } from "../models/mongo/WorkOrder";

export type CustomerPastDue = {
  count: number;
  totalCents: number;
};

export const PAST_DUE_WORK_ORDER_MATCH = {
  completed: true,
  paid: false,
  total: { $gt: 0 },
  deletedAt: null,
} as const;

export function dollarsToCents(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round(total * 100);
}

export function addPastDue(
  current: CustomerPastDue | undefined,
  add: { count: number; totalCents: number },
): CustomerPastDue {
  return {
    count: (current?.count ?? 0) + add.count,
    totalCents: (current?.totalCents ?? 0) + add.totalCents,
  };
}

export function indexPastDueGroups(
  rows: Array<{
    customerRef?: string | null;
    customerId?: number | null;
    count: number;
    total: number;
  }>,
): Map<string, CustomerPastDue> {
  const map = new Map<string, CustomerPastDue>();
  for (const row of rows) {
    const amount = {
      count: row.count,
      totalCents: dollarsToCents(row.total),
    };
    if (amount.count <= 0 || amount.totalCents <= 0) continue;
    const ref = row.customerRef ? String(row.customerRef) : "";
    if (ref) {
      map.set(`ref:${ref}`, addPastDue(map.get(`ref:${ref}`), amount));
    } else if (typeof row.customerId === "number") {
      map.set(
        `legacy:${row.customerId}`,
        addPastDue(map.get(`legacy:${row.customerId}`), amount),
      );
    }
  }
  return map;
}

/** Combine ref-keyed and legacy-keyed totals for the same customer without double-counting. */
export function mergePastDueKeys(
  map: Map<string, CustomerPastDue>,
  legacyByRef: Map<string, number>,
): Map<string, CustomerPastDue> {
  for (const [ref, legacyId] of legacyByRef) {
    if (typeof legacyId !== "number") continue;
    const refKey = `ref:${ref}`;
    const legacyKey = `legacy:${legacyId}`;
    const refVal = map.get(refKey);
    const legacyVal = map.get(legacyKey);
    if (!refVal && !legacyVal) continue;
    const merged = addPastDue(refVal, {
      count: legacyVal?.count ?? 0,
      totalCents: legacyVal?.totalCents ?? 0,
    });
    map.set(refKey, merged);
    map.set(legacyKey, merged);
  }
  return map;
}

export function pastDueForCustomer(
  map: Map<string, CustomerPastDue>,
  customerRef?: string | null,
  legacyId?: number | null,
): CustomerPastDue | null {
  if (customerRef) {
    const hit = map.get(`ref:${customerRef}`);
    if (hit && hit.count > 0) return hit;
  }
  if (typeof legacyId === "number") {
    const hit = map.get(`legacy:${legacyId}`);
    if (hit && hit.count > 0) return hit;
  }
  return null;
}

export async function loadPastDueByCustomer(opts: {
  customerRefs?: Array<Types.ObjectId | string>;
  legacyIds?: number[];
  legacyByRef?: Map<string, number>;
}): Promise<Map<string, CustomerPastDue>> {
  const refs = [...new Set((opts.customerRefs ?? []).map((id) => String(id)))].filter(
    (id) => Types.ObjectId.isValid(id),
  );
  const legacyIds = [
    ...new Set(
      (opts.legacyIds ?? []).filter((id) => Number.isFinite(id)),
    ),
  ];
  if (refs.length === 0 && legacyIds.length === 0) return new Map();

  const ownership: Record<string, unknown>[] = [];
  if (refs.length > 0) {
    ownership.push({
      customerRef: { $in: refs.map((id) => new Types.ObjectId(id)) },
    });
  }
  if (legacyIds.length > 0) {
    ownership.push({ customerId: { $in: legacyIds } });
  }

  const rows = await WorkOrder.aggregate<{
    _id: { ref: Types.ObjectId | null; legacy: number | null };
    count: number;
    total: number;
  }>([
    { $match: { ...PAST_DUE_WORK_ORDER_MATCH, $or: ownership } },
    {
      $group: {
        _id: {
          ref: { $ifNull: ["$customerRef", null] },
          legacy: { $ifNull: ["$customerId", null] },
        },
        count: { $sum: 1 },
        total: { $sum: "$total" },
      },
    },
  ]);

  const map = indexPastDueGroups(
    rows.map((row) => ({
      customerRef: row._id.ref ? String(row._id.ref) : null,
      customerId: typeof row._id.legacy === "number" ? row._id.legacy : null,
      count: row.count,
      total: row.total,
    })),
  );
  return mergePastDueKeys(map, opts.legacyByRef ?? new Map());
}
