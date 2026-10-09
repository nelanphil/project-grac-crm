import type { NotificationEntityType, NotificationItem } from "@/lib/api";
import { isCustomerRole } from "@/lib/dashboard-role";

const ENTITY_LABELS: Record<NotificationEntityType, string> = {
  customer: "Customer",
  contact: "Contact",
  address: "Address",
  equipment: "Equipment",
  work_order: "Work order",
  contract: "Contract",
  customer_note: "Note",
  work_order_note: "Work order note",
  estimate_note: "Estimate note",
  user: "User",
  role: "Role",
  twilio_account: "Twilio",
  email_account: "Email",
  contract_template: "Template",
  lead: "Lead",
  google_credentials: "Google",
  recaptcha_credentials: "reCAPTCHA",
  payment_provider_account: "Payment provider",
  invoice: "Invoice",
  product: "Product",
  estimate: "Estimate",
  discount_code: "Discount code",
  mailbox_message: "Email",
};

export function notificationEntityLabel(type: NotificationEntityType): string {
  return ENTITY_LABELS[type] ?? type;
}

export function notificationHref(
  item: NotificationItem,
  role?: string | { role?: string; roles?: string[] },
): string | null {
  if (isCustomerRole(role)) {
    if (item.entityType === "invoice") {
      return `/dashboard/orders/detail?id=${item.entityId}`;
    }
    return "/dashboard";
  }

  if (item.entityType === "work_order_note") {
    const id = String(item.metadata.workOrderId ?? "");
    if (id) return `/dashboard/work-orders/detail?id=${id}`;
  }
  if (item.entityType === "estimate_note") {
    const id = String(item.metadata.estimateId ?? "");
    if (id) return `/dashboard/estimates/detail?id=${id}`;
  }

  if (item.customerRef) {
    return `/dashboard/customers/detail?id=${item.customerRef}`;
  }

  switch (item.entityType) {
    case "contract":
      return "/dashboard/contracts";
    case "work_order":
    case "work_order_note":
      return "/dashboard/work-orders";
    case "user":
    case "role":
      return "/dashboard/settings";
    case "contract_template":
      return "/dashboard/control-panel";
    case "twilio_account":
    case "email_account":
      return "/dashboard/control-panel?tab=communications";
    case "google_credentials":
    case "recaptcha_credentials":
      return "/dashboard/control-panel?tab=api-services";
    case "payment_provider_account":
      return "/dashboard/control-panel?tab=payments";
    case "invoice":
      return "/dashboard/orders";
    case "product":
      return "/dashboard/products";
    case "discount_code":
      return "/dashboard/discount-codes";
    case "estimate":
      return "/dashboard/estimates";
    case "lead":
      return "/dashboard";
    case "mailbox_message": {
      const accountId = String(item.metadata.accountId ?? "");
      const folder = item.metadata.folder === "sent" ? "sent" : "inbox";
      const uid = Number(item.metadata.uid);
      if (!accountId || !Number.isInteger(uid) || uid < 1) {
        return "/dashboard/messaging?tab=threads&view=email";
      }
      const params = new URLSearchParams({
        tab: "threads",
        view: "email",
        accountId,
        folder,
        uid: String(uid),
      });
      return `/dashboard/messaging?${params.toString()}`;
    }
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
