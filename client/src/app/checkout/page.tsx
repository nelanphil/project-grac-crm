"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CheckoutCartView from "@/components/billing/CheckoutCart";
import {
  ApiError,
  CheckoutCart,
  getCheckoutByKey,
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
  const key = (searchParams.get("c") ?? "").trim();
  const preselectInvoiceId = searchParams.get("invoiceId") ?? undefined;
  const preselectWorkOrderId = searchParams.get("workOrderId") ?? undefined;

  const [cart, setCart] = useState<CheckoutCart | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState<string | null>(
    key ? null : "Checkout link is missing.",
  );
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!key) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getCheckoutByKey(key)
      .then(setCart)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Checkout link not found.",
        ),
      )
      .finally(() => setLoading(false));
  }, [key]);

  async function handlePay(
    invoiceIds: string[],
    workOrderIds: string[],
    discountCode?: string,
  ) {
    setPaying(true);
    setError(null);
    try {
      const { url } = await startCheckoutByKey(key, {
        invoiceIds,
        workOrderIds,
        discountCode,
      });
      window.location.href = url;
    } catch (err) {
      setError(
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
