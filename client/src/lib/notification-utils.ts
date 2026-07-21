import type { NotificationEntityType, NotificationItem } from "@/lib/api";

const ENTITY_LABELS: Record<NotificationEntityType, string> = {
  customer: "Customer",
  contact: "Contact",
  address: "Address",
  equipment: "Equipment",
  work_order: "Work order",
  contract: "Contract",
  customer_note: "Note",
  user: "User",
  role: "Role",
  twilio_account: "Twilio",
  contract_template: "Template",
  lead: "Lead",
};

export function notificationEntityLabel(type: NotificationEntityType): string {
  return ENTITY_LABELS[type] ?? type;
}

export function notificationHref(item: NotificationItem): string | null {
  if (item.customerRef) {
    return `/dashboard/customers/detail?id=${item.customerRef}`;
  }

  switch (item.entityType) {
    case "contract":
      return "/dashboard/contracts";
    case "work_order":
      return "/dashboard/orders";
    case "user":
    case "role":
      return "/dashboard/settings";
    case "contract_template":
    case "twilio_account":
      return "/dashboard/control-panel";
    case "lead":
      return "/dashboard";
    default:
      return null;
  }
}

export function formatNotificationTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = Date.now();
  const diffMs = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
