export interface ActivityLinkItem {
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

function idOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function customerTab(customerId: string, tab: string): string {
  const params = new URLSearchParams({ id: customerId, tab });
  return `/dashboard/customers/detail?${params.toString()}`;
}

export function isCustomerPageHref(href: string): boolean {
  return href.startsWith("/dashboard/customers/detail");
}

/** Where a history entry should go. Null when the entry has no record to open. */
export function activityHref(
  item: ActivityLinkItem,
  customerId: string,
): string | null {
  if (item.action === "deleted") return null;
  const entityId = idOf(item.entityId);
  const metadata = item.metadata ?? {};

  switch (item.entityType) {
    case "work_order":
      return entityId ? `/dashboard/work-orders/detail?id=${entityId}` : null;
    case "work_order_note": {
      const workOrderId = idOf(metadata.workOrderId);
      return workOrderId
        ? `/dashboard/work-orders/detail?id=${workOrderId}`
        : null;
    }
    case "estimate":
      return entityId ? `/dashboard/estimates/detail?id=${entityId}` : null;
    case "estimate_note": {
      const estimateId = idOf(metadata.estimateId);
      return estimateId ? `/dashboard/estimates/detail?id=${estimateId}` : null;
    }
    case "invoice":
      return entityId ? `/dashboard/orders/detail?id=${entityId}` : null;
    case "contract": {
      if (!entityId) return null;
      const returnTo = `/dashboard/customers/detail?id=${customerId}`;
      return `/dashboard/contracts/edit?id=${entityId}&returnTo=${encodeURIComponent(returnTo)}`;
    }
    case "customer_note":
      return customerTab(customerId, "notes");
    case "contact":
      return customerTab(customerId, "contacts");
    case "address":
    case "equipment":
      return customerTab(customerId, "address");
    case "twilio_communication": {
      const threadId = idOf(metadata.threadId);
      if (threadId) return "/dashboard/inboxes";
      return customerTab(customerId, "communications");
    }
    case "email_communication":
    case "sms_message":
      return customerTab(customerId, "communications");
    case "mailbox_message":
      return "/dashboard/inboxes";
    default:
      return null;
  }
}
