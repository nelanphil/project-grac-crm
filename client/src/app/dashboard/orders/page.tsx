"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, getInvoices, InvoiceItem } from "@/lib/api";
import { FileText } from "lucide-react";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function OrdersPage() {
  return (
    <AuthGuard>
      <OrdersContent />
    </AuthGuard>
  );
}

function OrdersContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getInvoices(token)
      .then(({ invoices: list }) => setInvoices(list))
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load invoices.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  const isCustomer = user?.role === "customer";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">
          {isCustomer ? "My invoices" : "Invoices"}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {isCustomer
            ? "View and pay open invoices for your contracts and work orders."
            : "All invoices across customers."}
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
          <FileText className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-500">
            No invoices yet
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Invoices for renewals and work orders will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-neutral-100 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Invoice
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {invoices.map((inv) => (
                <tr
                  key={inv._id}
                  role="link"
                  tabIndex={0}
                  onClick={() =>
                    router.push(`/dashboard/orders/detail?id=${inv._id}`)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/dashboard/orders/detail?id=${inv._id}`);
                    }
                  }}
                  className="cursor-pointer transition hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none"
                >
                  <td className="px-6 py-4 font-medium text-brand-dark">
                    {inv.number}
                    <div className="text-xs font-normal text-neutral-400">
                      {new Date(inv.issuedAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-neutral-600 capitalize">
                    {inv.sourceType.replace(/_/g, " ")}
                  </td>
                  <td className="px-6 py-4 text-neutral-700">
                    {formatMoney(inv.amountCents)}
                  </td>
                  <td className="px-6 py-4 capitalize text-neutral-600">
                    {inv.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
