"use client";

import { useEffect, useMemo, useState } from "react";
import { Tag, X } from "lucide-react";
import type { CheckoutCart, CheckoutDiscountPreview, CheckoutItem } from "@/lib/api";
import { ApiError } from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function itemKey(item: CheckoutItem): string {
  return `${item.kind}:${item.id}`;
}

function kindLabel(item: CheckoutItem): string {
  if (item.kind === "work_order") return "Work order";
  return (item.sourceType ?? "invoice").replace(/_/g, " ");
}

type Props = {
  cart: CheckoutCart | null;
  loading: boolean;
  error: string | null;
  paying: boolean;
  preselectInvoiceId?: string;
  preselectWorkOrderId?: string;
  onPay: (
    invoiceIds: string[],
    workOrderIds: string[],
    discountCode?: string,
  ) => void;
  previewDiscount: (input: {
    code: string;
    invoiceIds: string[];
    workOrderIds: string[];
  }) => Promise<CheckoutDiscountPreview>;
};

export default function CheckoutCartView({
  cart,
  loading,
  error,
  paying,
  preselectInvoiceId,
  preselectWorkOrderId,
  onPay,
  previewDiscount,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [quote, setQuote] = useState<CheckoutDiscountPreview | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);

  useEffect(() => {
    if (!cart) return;
    const preselect = new Set<string>();
    if (preselectInvoiceId) {
      preselect.add(`invoice:${preselectInvoiceId}`);
    }
    if (preselectWorkOrderId) {
      preselect.add(`work_order:${preselectWorkOrderId}`);
    }
    const next = new Set<string>();
    for (const item of cart.items) {
      const key = itemKey(item);
      if (preselect.size === 0 || preselect.has(key)) {
        next.add(key);
      }
    }
    if (preselect.size > 0 && next.size === 0) {
      for (const item of cart.items) next.add(itemKey(item));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(next);
  }, [cart, preselectInvoiceId, preselectWorkOrderId]);

  const selectedItems = useMemo(
    () => (cart?.items ?? []).filter((item) => selected.has(itemKey(item))),
    [cart, selected],
  );
  const selectedTotal = selectedItems.reduce(
    (sum, item) => sum + item.amountCents,
    0,
  );
  const invoiceIds = selectedItems
    .filter((item) => item.kind === "invoice")
    .map((item) => item.id);
  const workOrderIds = selectedItems
    .filter((item) => item.kind === "work_order")
    .map((item) => item.id);
  const selectionKey = `${invoiceIds.join(",")}|${workOrderIds.join(",")}`;

  useEffect(() => {
    if (!appliedCode || selectedItems.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null);
      return;
    }
    let cancelled = false;
    setDiscountLoading(true);
    setDiscountError(null);
    previewDiscount({
      code: appliedCode,
      invoiceIds,
      workOrderIds,
    })
      .then((next) => {
        if (cancelled) return;
        setQuote(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setQuote(null);
        setAppliedCode(null);
        setDiscountError(
          err instanceof ApiError ? err.message : "Could not apply discount code.",
        );
      })
      .finally(() => {
        if (!cancelled) setDiscountLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // invoiceIds / workOrderIds are derived from selectionKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedCode, selectionKey]);

  function toggle(item: CheckoutItem) {
    const key = itemKey(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleApply() {
    const code = codeInput.trim();
    if (!code || selectedItems.length === 0) return;
    setAppliedCode(code.toUpperCase());
  }

  function handleRemoveCode() {
    setAppliedCode(null);
    setQuote(null);
    setDiscountError(null);
    setCodeInput("");
  }

  function handlePay() {
    onPay(invoiceIds, workOrderIds, quote?.code);
  }

  const items = cart?.items ?? [];
  const allPaid = Boolean(cart && items.length === 0 && !loading && !error);
  const discountCents = quote?.discountCents ?? 0;
  const totalDue = Math.max(selectedTotal - discountCents, 0);
  const itemCount = selectedItems.length || items.length;

  return (
    <div className="w-full max-w-5xl space-y-6 uppercase">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Checkout</h1>
        {cart?.customerLabel ? (
          <p className="mt-1 text-sm text-neutral-500">{cart.customerLabel}</p>
        ) : null}
        {!loading && !allPaid && items.length > 0 ? (
          <p className="mt-1 text-sm text-neutral-500">
            {itemCount} {itemCount === 1 ? "item" : "items"} selected
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">
          Loading…
        </div>
      ) : error && items.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-red-600 shadow-sm">
          {error}
        </div>
      ) : allPaid ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-green-700 shadow-sm">
          You have nothing due. Thank you!
        </div>
      ) : items.length > 0 ? (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <section className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-brand-dark">
              Order Summary
            </h2>
            <ul className="space-y-2">
              {items.map((item) => {
                const key = itemKey(item);
                const checked = selected.has(key);
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-brand-dark"
                        checked={checked}
                        onChange={() => toggle(item)}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="font-medium text-brand-dark">
                          {item.number}
                        </div>
                        <div className="text-neutral-600">{item.description}</div>
                        <div className="flex items-baseline justify-between gap-3 pt-1">
                          <div className="text-lg font-semibold text-brand-dark">
                            {formatMoney(item.amountCents)}
                          </div>
                          <div className="text-xs uppercase text-neutral-500">
                            {kindLabel(item)}
                          </div>
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="w-full shrink-0 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4 h-fit md:w-80 lg:w-96">
            <h2 className="text-lg font-semibold text-brand-dark">
              Payment Summary
            </h2>

            <div className="space-y-2 text-sm">
              {selectedItems.length > 0 ? (
                <ul className="space-y-2 border-b border-neutral-200 pb-3">
                  {selectedItems.map((item) => (
                    <li
                      key={itemKey(item)}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="min-w-0 truncate text-neutral-600">
                        {item.description.trim() || item.number}
                      </span>
                      <span className="shrink-0 font-medium text-brand-dark">
                        {formatMoney(item.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-baseline justify-between">
                <span className="text-neutral-600">Subtotal</span>
                <span className="font-medium text-brand-dark">
                  {formatMoney(selectedTotal)}
                </span>
              </div>
              {quote && discountCents > 0 ? (
                <div className="flex items-baseline justify-between text-emerald-700">
                  <span>Discount {quote.code}</span>
                  <span>−{formatMoney(discountCents)}</span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3">
                <span className="text-sm font-medium text-neutral-600">
                  Total
                </span>
                <span className="text-lg font-semibold text-brand-dark">
                  {formatMoney(totalDue)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-brand-dark">
                <Tag className="h-4 w-4" />
                Discount code
              </div>
              {quote ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <span className="font-medium">{quote.code}</span>
                  <button
                    type="button"
                    onClick={handleRemoveCode}
                    className="rounded-md p-1 hover:bg-emerald-100"
                    aria-label="Remove discount code"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={codeInput}
                    onChange={(e) => {
                      setCodeInput(e.target.value.toUpperCase());
                      if (discountError) setDiscountError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleApply();
                      }
                    }}
                    placeholder="Enter code"
                    className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm uppercase text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  />
                  <button
                    type="button"
                    disabled={discountLoading || !codeInput.trim()}
                    onClick={handleApply}
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                  >
                    {discountLoading ? "Applying…" : "Apply"}
                  </button>
                </div>
              )}
              {discountError ? (
                <p className="text-sm text-red-600">{discountError}</p>
              ) : null}
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="button"
              disabled={
                paying ||
                selectedItems.length === 0 ||
                Boolean(appliedCode && discountLoading)
              }
              onClick={handlePay}
              className="w-full rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {paying ? "Redirecting to checkout…" : "Pay securely"}
            </button>
          </section>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">
          Nothing is due right now.
        </div>
      )}
    </div>
  );
}
