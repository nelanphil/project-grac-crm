"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CheckoutCartView from "@/components/billing/CheckoutCart";
import {
  ApiError,
  CheckoutCart,
  getCheckoutByKey,
  getCheckoutKeyByPayCode,
  previewCheckoutDiscountByKey,
  startCheckoutByKey,
} from "@/lib/api";
import {
  captureJourneySnapshot,
  journeyStep,
  PAY_SNAPSHOT_WAIT_MS,
  settleWithin,
  snapshotAfterPaint,
  startPaymentJourney,
  updatePaymentJourneyLink,
} from "@/lib/paymentJourney";

export default function PublicCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <PublicCheckoutContent />
    </Suspense>
  );
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function PublicCheckoutContent() {
  const searchParams = useSearchParams();
  const queryKey = (searchParams.get("c") ?? "").trim();
  const payCode = (searchParams.get("p") ?? "").trim();

  const [resolved, setResolved] = useState<{ code: string; key: string } | null>(
    null,
  );
  const [failedCode, setFailedCode] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [loaded, setLoaded] = useState<{
    key: string;
    cart: CheckoutCart;
  } | null>(null);
  const [failedCart, setFailedCart] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const resolvedPayKey =
    !queryKey && resolved?.code === payCode ? resolved.key : "";
  const key = queryKey || resolvedPayKey;
  const resolveError =
    !queryKey && failedCode?.code === payCode ? failedCode.message : null;
  const cart = loaded?.key === key ? loaded.cart : null;
  const cartError = failedCart?.key === key ? failedCart.message : null;
  const resolving = Boolean(
    payCode && !queryKey && !resolvedPayKey && !resolveError,
  );
  const loading = resolving || Boolean(key && !cart && !cartError);
  const error =
    payError ??
    (!queryKey && !payCode
      ? "Checkout link is missing."
      : (resolveError ?? cartError));

  useEffect(() => {
    if (!queryKey && !payCode) return;
    return startPaymentJourney({
      entry: "checkout",
      link: { checkoutKey: queryKey, payCode },
    });
  }, [queryKey, payCode]);

  useEffect(() => {
    if (queryKey || !payCode) return;
    let cancelled = false;
    getCheckoutKeyByPayCode(payCode)
      .then((checkoutKey) => {
        if (cancelled) return;
        updatePaymentJourneyLink({ checkoutKey });
        journeyStep("link_resolved");
        setResolved({ code: payCode, key: checkoutKey });
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? err.message : "Checkout link not found.";
        journeyStep("link_invalid", message);
        snapshotAfterPaint("link_invalid");
        setFailedCode({ code: payCode, message });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, payCode]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getCheckoutByKey(key)
      .then((next) => {
        if (cancelled) return;
        journeyStep(
          "cart_loaded",
          `${next.items.length} item${next.items.length === 1 ? "" : "s"}, ${formatMoney(next.totalCents)}`,
        );
        setLoaded({ key, cart: next });
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? err.message : "Checkout link not found.";
        journeyStep("link_invalid", message);
        snapshotAfterPaint("link_invalid");
        setFailedCart({ key, message });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  async function handlePay(
    invoiceIds: string[],
    workOrderIds: string[],
    discountCode?: string,
  ) {
    journeyStep(
      "pay_clicked",
      `${invoiceIds.length + workOrderIds.length} selected${discountCode ? ", discount applied" : ""}`,
    );
    const clickedAt = Date.now();
    const snapshot = captureJourneySnapshot("pay_clicked");
    setPaying(true);
    setPayError(null);
    try {
      const { url } = await startCheckoutByKey(key, {
        invoiceIds,
        workOrderIds,
        discountCode,
      });
      journeyStep("redirect_to_square");
      await settleWithin(snapshot, PAY_SNAPSHOT_WAIT_MS - (Date.now() - clickedAt));
      window.location.href = url;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to start checkout.";
      journeyStep("checkout_start_failed", message);
      snapshotAfterPaint("checkout_start_failed");
      setPayError(message);
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start justify-center px-4 py-10">
      <CheckoutCartView
        cart={cart}
        loading={loading}
        error={error}
        paying={paying}
        onPay={handlePay}
        onStep={journeyStep}
        previewDiscount={({ code, invoiceIds, workOrderIds }) =>
          previewCheckoutDiscountByKey(key, { code, invoiceIds, workOrderIds }).then(
            (quote) => {
              journeyStep("discount_applied", formatMoney(quote.discountCents));
              return quote;
            },
            (err: unknown) => {
              journeyStep(
                "discount_rejected",
                err instanceof ApiError ? err.message : "Could not apply discount code.",
              );
              throw err;
            },
          )
        }
      />
    </div>
  );
}
