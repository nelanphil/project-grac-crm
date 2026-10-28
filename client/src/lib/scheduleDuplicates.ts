import { normalizeTimeOfDay, workOrderLocalDate } from "./schedule";

/** A work order, narrowed to the fields duplicate detection and rail sorting need. */
export type ScheduleIdentity = {
  _id: string;
  customerRef?: string | null;
  customerId?: number | null;
  customerName?: string | null;
  scheduledStart?: string | null;
  date?: string | null;
  completed?: boolean;
  appointmentCanceledAt?: string | null;
  desiredStartTime?: string | null;
};

/** Stable identity: customer record, then legacy id, then normalized name. */
export function customerKey(job: ScheduleIdentity): string {
  const ref = job.customerRef?.trim();
  if (ref) return `ref:${ref}`;
  if (typeof job.customerId === "number" && Number.isFinite(job.customerId)) {
    return `id:${job.customerId}`;
  }
  const name = job.customerName?.trim().toLowerCase().replace(/\s+/g, " ");
  if (name) return `name:${name}`;
  return "";
}

function isOpen(job: ScheduleIdentity): boolean {
  return !job.completed && !job.appointmentCanceledAt;
}

/**
 * Ids of open work orders that share a customer and a local calendar day
 * with at least one other open work order.
 */
export function findDuplicateIds(jobs: ScheduleIdentity[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const job of jobs) {
    if (!isOpen(job)) continue;
    const key = customerKey(job);
    if (!key) continue;
    const date = workOrderLocalDate(job);
    if (!date) continue;
    const bucket = `${date}|${key}`;
    const list = groups.get(bucket);
    if (list) list.push(job._id);
    else groups.set(bucket, [job._id]);
  }
  const ids = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const id of list) ids.add(id);
  }
  return ids;
}

/** Other open work orders for the same customer already on `date`. */
export function duplicatesFor<T extends ScheduleIdentity>(
  job: ScheduleIdentity,
  date: string,
  jobs: T[],
): T[] {
  const key = customerKey(job);
  if (!key || !date) return [];
  return jobs.filter((other) => {
    if (other._id === job._id || !isOpen(other)) return false;
    if (customerKey(other) !== key) return false;
    return workOrderLocalDate(other) === date;
  });
}

/** Minutes from midnight for a desired start, or Infinity when none is set. */
export function desiredMinutes(job: {
  desiredStartTime?: string | null;
}): number {
  const value = normalizeTimeOfDay(job.desiredStartTime);
  if (!value) return Number.POSITIVE_INFINITY;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Unscheduled jobs first, earliest desired start at the top.
 * Jobs with no desired time follow those that have one.
 * Scheduled jobs stay in start-time order.
 */
export function compareWithinDay(
  a: ScheduleIdentity,
  b: ScheduleIdentity,
): number {
  const aScheduled = a.scheduledStart ? 1 : 0;
  const bScheduled = b.scheduledStart ? 1 : 0;
  if (aScheduled !== bScheduled) return aScheduled - bScheduled;
  if (!aScheduled) {
    const aMin = desiredMinutes(a);
    const bMin = desiredMinutes(b);
    if (aMin !== bMin) {
      if (!Number.isFinite(aMin)) return 1;
      if (!Number.isFinite(bMin)) return -1;
      return aMin - bMin;
    }
    return (a.customerName ?? "").localeCompare(b.customerName ?? "");
  }
  return (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? "");
}
