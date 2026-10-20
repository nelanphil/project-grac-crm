import type { CheckoutLinkItem } from "../models/mongo/CheckoutLink";

export const CHANGED_CHECKOUT_MESSAGE =
  "This invoice or balance has changed since the payment link was sent. Please request a new payment link.";

export function checkoutScopeMatches(
  expected: CheckoutLinkItem[],
  current: CheckoutLinkItem[],
): boolean {
  if (expected.length === 0 || current.length !== expected.length) return false;
  const byKey = new Map(current.map((item) => [`${item.kind}:${item.id}`, item.amountCents]));
  return expected.every((item) =>
    byKey.get(`${item.kind}:${item.id}`) === item.amountCents,
  );
}

export function checkoutSelectionAllowed(
  items: CheckoutLinkItem[],
  invoiceIds: string[] = [],
  workOrderIds: string[] = [],
): boolean {
  const allowed = new Set(items.map((item) => `${item.kind}:${item.id}`));
  return invoiceIds.length + workOrderIds.length > 0 &&
    invoiceIds.every((id) => allowed.has(`invoice:${id}`)) &&
    workOrderIds.every((id) => allowed.has(`work_order:${id}`));
}
