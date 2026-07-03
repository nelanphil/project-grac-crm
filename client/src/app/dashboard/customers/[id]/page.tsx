"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, ScrollText } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ServiceContractsTable from "@/components/contracts/ServiceContractsTable";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getCustomer,
  getWorkOrdersForCustomer,
  getContractsForCustomer,
  CustomerDetail,
  WorkOrderListItem,
  ContractListItem,
  ApiError,
} from "@/lib/api";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-1 text-sm text-brand-dark">{value || "—"}</dd>
    </div>
  );
}

function StatusBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20"
          : "bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-neutral-300"
      }`}
    >
      {label}
    </span>
  );
}

function CustomerDetailContent() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderListItem[]>([]);
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!token || !id || user?.role === "customer") return;

    setLoading(true);
    setError(null);

    getCustomer(token, id)
      .then(({ customer: c }) => {
        setCustomer(c);
        return Promise.all([
          getWorkOrdersForCustomer(token, c.legacyId),
          getContractsForCustomer(token, c.legacyId),
        ]);
      })
      .then(([orders, { contracts: contractList }]) => {
        setWorkOrders(orders);
        setContracts(contractList);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load customer.")
      )
      .finally(() => setLoading(false));
  }, [token, id, user]);

  if (!user || user.role === "customer") return null;

  if (loading) {
    return <div className="text-sm text-neutral-500 py-6">Loading customer…</div>;
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/customers"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Link>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? "Customer not found."}
        </div>
      </div>
    );
  }

  const fullAddress = [customer.address, customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/customers"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-brand-dark">
          {customer.first} {customer.last}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">Customer details and work order history</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-brand-dark mb-4">Contact</h2>
          <dl className="space-y-4">
            <InfoRow label="Name" value={`${customer.first} ${customer.last}`} />
            <InfoRow label="Email" value={customer.email} />
            <InfoRow label="Phone" value={customer.phone} />
            <InfoRow label="Address" value={fullAddress} />
          </dl>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-brand-dark mb-4">Equipment</h2>
          <dl className="space-y-4">
            <InfoRow label="Generator Model" value={customer.generatorModel} />
            <InfoRow label="Serial" value={customer.serial} />
            <InfoRow label="ATS Serial" value={customer.atsSerial} />
          </dl>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-brand-dark mb-4">Service</h2>
          <dl className="space-y-4">
            <InfoRow label="Last Service" value={formatDate(customer.lastSvc)} />
            <InfoRow label="Extended Day" value={customer.exday} />
            <InfoRow label="Extended Time" value={customer.extime} />
          </dl>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-brand-dark">
          Service Contracts ({contracts.length})
        </h2>

        {contracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-12 text-center shadow-sm">
            <ScrollText className="h-10 w-10 text-neutral-300 mb-4" />
            <p className="text-sm font-medium text-neutral-500">No service contracts</p>
            <p className="mt-1 text-xs text-neutral-400">
              Service contracts for this customer will appear here.
            </p>
          </div>
        ) : (
          <ServiceContractsTable
            contracts={contracts}
            returnTo={`/dashboard/customers/${id}`}
          />
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-brand-dark">
          Work Orders ({workOrders.length})
        </h2>

        {workOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center shadow-sm">
            <ClipboardList className="h-10 w-10 text-neutral-300 mb-4" />
            <p className="text-sm font-medium text-neutral-500">No work orders yet</p>
            <p className="mt-1 text-xs text-neutral-400">
              Work orders for this customer will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Technician
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white">
                  {workOrders.map((order) => (
                    <tr key={order._id}>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {formatDate(order.date)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {order.descPerform || order.descPerformed || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {order.tech || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {formatCurrency(order.total)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <StatusBadge label="Paid" active={order.paid} />
                          <StatusBadge label="Completed" active={order.completed} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <AuthGuard>
      <CustomerDetailContent />
    </AuthGuard>
  );
}
