import type { WorkOrderListItem } from "@/lib/api";
import {
  formatDesiredStart,
  formatLocalClock,
  formatLocalDate,
  formatTimeWindow,
} from "@/lib/schedule";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Matches the server's stored ticket date, including legacy UTC-midnight rows. */
function storedTicketDateKey(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const utcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (utcMidnight) return date.toISOString().slice(0, 10);
  return formatLocalDate(date);
}

function crewIds(order: WorkOrderListItem): string[] {
  const listed = (order.assignedUserRefs ?? [])
    .map((id) => String(id))
    .filter((id) => OBJECT_ID.test(id));
  const unique = [...new Set(listed)];
  if (unique.length > 0) return unique;
  const single = order.assignedUserRef ? String(order.assignedUserRef) : "";
  return OBJECT_ID.test(single) ? [single] : [];
}

function appointmentDateKey(order: WorkOrderListItem): string {
  const date = toDate(order.date);
  const start = toDate(order.scheduledStart);
  return storedTicketDateKey(date) ?? (start ? formatLocalDate(start) : "");
}

/** Same shape as the server key: date, dispatch instant, sorted crew. */
export function appointmentNoticeKey(order: WorkOrderListItem): string {
  const start = toDate(order.scheduledStart);
  const techs = [...crewIds(order)].sort().join(",");
  return `${appointmentDateKey(order)}|${start ? start.toISOString() : ""}|${techs}`;
}

export function appointmentNeedsNotice(order: WorkOrderListItem): boolean {
  if (order.deletedAt || order.completed) return false;
  if (!appointmentDateKey(order) || crewIds(order).length === 0) return false;
  return appointmentNoticeKey(order) !== (order.appointmentNoticeKey ?? "");
}

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function appointmentWhenLabel(order: WorkOrderListItem): string {
  const dateKey = appointmentDateKey(order);
  const dateLabel = dateKey ? formatDateKey(dateKey) : "";
  if (order.scheduledStart) {
    const start = toDate(order.scheduledStart);
    const clock = start ? formatLocalClock(start) : "";
    return clock ? `${dateLabel} at ${clock}` : dateLabel;
  }
  const desired = formatDesiredStart(order.desiredStartTime, order.desiredStartBy);
  if (desired) return `${dateLabel} (${desired})`;
  const window = formatTimeWindow(order.startTime, order.endTime);
  if (window) return `${dateLabel} (${window})`;
  return dateLabel;
}

export function appointmentTechnicianLabel(order: WorkOrderListItem): string {
  const fromCrew = (order.assignees ?? [])
    .map((tech) => `${tech.first_name ?? ""} ${tech.last_name ?? ""}`.trim())
    .filter(Boolean);
  if (fromCrew.length > 0) return fromCrew.join(", ");
  if (order.assignee) {
    const name = `${order.assignee.first_name ?? ""} ${order.assignee.last_name ?? ""}`.trim();
    if (name) return name;
  }
  return order.tech?.trim() || "the technician";
}
