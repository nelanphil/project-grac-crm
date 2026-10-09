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

export default function PublicCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <PublicCheckoutContent />
    </Suspense>
  );
}

function PublicCheckoutContent() {
  const searchParams = useSearchParams();
  const queryKey = (searchParams.get("c") ?? "").trim();
  const payCode = (searchParams.get("p") ?? "").trim();
  const preselectInvoiceId = searchParams.get("invoiceId") ?? undefined;
  const preselectWorkOrderId = searchParams.get("workOrderId") ?? undefined;

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
    if (queryKey || !payCode) return;
    let cancelled = false;
    getCheckoutKeyByPayCode(payCode)
      .then((checkoutKey) => {
        if (!cancelled) setResolved({ code: payCode, key: checkoutKey });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailedCode({
          code: payCode,
          message:
            err instanceof ApiError ? err.message : "Checkout link not found.",
        });
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
        if (!cancelled) setLoaded({ key, cart: next });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailedCart({
          key,
          message:
            err instanceof ApiError ? err.message : "Checkout link not found.",
        });
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
    setPaying(true);
    setPayError(null);
    try {
      const { url } = await startCheckoutByKey(key, {
        invoiceIds,
        workOrderIds,
        discountCode,
      });
      window.location.href = url;
    } catch (err) {
      setPayError(
        err instanceof ApiError ? err.message : "Failed to start checkout.",
      );
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
        preselectInvoiceId={preselectInvoiceId}
        preselectWorkOrderId={preselectWorkOrderId}
        onPay={handlePay}
        previewDiscount={({ code, invoiceIds, workOrderIds }) =>
          previewCheckoutDiscountByKey(key, { code, invoiceIds, workOrderIds })
        }
      />
    </div>
  );
}
