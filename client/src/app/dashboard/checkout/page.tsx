"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import CheckoutCartView from "@/components/billing/CheckoutCart";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  CheckoutCart,
  getMyCheckout,
  previewMyCheckoutDiscount,
  startMyCheckoutSession,
} from "@/lib/api";

export default function DashboardCheckoutPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="text-sm text-neutral-500 py-6">Loading checkout…</div>
        }
      >
        <DashboardCheckoutContent />
      </Suspense>
    </AuthGuard>
  );
}

function DashboardCheckoutContent() {
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const preselectInvoiceId = searchParams.get("invoiceId") ?? undefined;
  const preselectWorkOrderId = searchParams.get("workOrderId") ?? undefined;

  const [cart, setCart] = useState<CheckoutCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getMyCheckout(token)
      .then(setCart)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load checkout.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handlePay(
    invoiceIds: string[],
    workOrderIds: string[],
    discountCode?: string,
  ) {
    if (!token) return;
    setPaying(true);
    setError(null);
    try {
      const { url } = await startMyCheckoutSession(token, {
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
    <div className="flex justify-center">
      <CheckoutCartView
        cart={cart}
        loading={loading}
        error={error}
        paying={paying}
        preselectInvoiceId={preselectInvoiceId}
        preselectWorkOrderId={preselectWorkOrderId}
        onPay={handlePay}
        previewDiscount={({ code, invoiceIds, workOrderIds }) => {
          if (!token) {
            return Promise.reject(new Error("Not signed in"));
          }
          return previewMyCheckoutDiscount(token, {
            code,
            invoiceIds,
            workOrderIds,
          });
        }}
      />
    </div>
  );
}
