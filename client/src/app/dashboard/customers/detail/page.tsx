"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardList, GitMerge, ScrollText } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ContactCard from "@/components/customers/ContactCard";
import CustomerAddressesPanel, {
  addressesSectionTitle,
  formatAddressLabel,
} from "@/components/customers/CustomerAddressesPanel";
import MergeCustomersDialog from "@/components/customers/MergeCustomersDialog";
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
import { formatCustomerName } from "@/lib/formatName";

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
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWrite = useAuthStore((s) => s.hasPermission("customers:write"));

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderListItem[]>([]);
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [addressFilter, setAddressFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeToast, setMergeToast] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!token || !id || user?.role === "customer") return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);

    getCustomer(token, id)
      .then(({ customer: c }) => {
        setCustomer({
          ...c,
          addresses: c.addresses ?? [],
          contacts: c.contacts ?? [],
        });
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
        setError(
          err instanceof ApiError ? err.message : "Failed to load customer.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, id, user]);

  const filteredWorkOrders = useMemo(() => {
    if (addressFilter === "all") return workOrders;
    return workOrders.filter(
      (wo) =>
        wo.addressRef === addressFilter || wo.address?._id === addressFilter,
    );
  }, [workOrders, addressFilter]);

  const filteredContracts = useMemo(() => {
    if (addressFilter === "all") return contracts;
    return contracts.filter(
      (c) => c.addressRef === addressFilter || c.address?._id === addressFilter,
    );
  }, [contracts, addressFilter]);

  if (!user || user.role === "customer") return null;

  if (loading) {
    return (
      <div className="text-sm text-neutral-500 py-6">Loading customer…</div>
    );
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

  const addresses = customer.addresses ?? [];
  const addressTitle = addressesSectionTitle();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/customers"
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Customers
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-brand-dark">
            {formatCustomerName(customer.first, customer.last)}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Customer details, addresses, and work order history
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange"
          >
            <GitMerge className="h-4 w-4" />
            Merge customer
          </button>
        ) : null}
      </div>

      {mergeToast ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {mergeToast}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <ContactCard
          customer={customer}
          token={token!}
          userId={user.id}
          canWrite={canWrite}
          onCustomerChange={setCustomer}
        />
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-lg font-semibold text-brand-dark">
            {addressTitle}
            {addresses.length > 0 ? ` (${addresses.length})` : ""}
            {addresses.some((a) => a.equipment.length > 0)
              ? " & equipment"
              : ""}
          </h2>
          <CustomerAddressesPanel
            customerId={customer._id}
            token={token!}
            addresses={addresses}
            canWrite={canWrite}
            onAddressesChange={(next) =>
              setCustomer((prev) =>
                prev ? { ...prev, addresses: next } : prev,
              )
            }
          />
        </div>
      </div>

      {addresses.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="address-filter"
            className="text-sm font-medium text-neutral-600"
          >
            Filter by address
          </label>
          <select
            id="address-filter"
            value={addressFilter}
            onChange={(e) => setAddressFilter(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          >
            <option value="all">All addresses</option>
            {addresses.map((addr) => (
              <option key={addr._id} value={addr._id}>
                {addr.label || formatAddressLabel(addr)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-brand-dark">
          Contracts ({filteredContracts.length})
        </h2>

        {filteredContracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-12 text-center shadow-sm">
            <ScrollText className="h-10 w-10 text-neutral-300 mb-4" />
            <p className="text-sm font-medium text-neutral-500">No contracts</p>
            <p className="mt-1 text-xs text-neutral-400">
              Contracts for this customer will appear here.
            </p>
          </div>
        ) : (
          <ServiceContractsTable
            contracts={filteredContracts}
            showAddress={addresses.length > 0}
            returnTo={`/dashboard/customers/detail?id=${id}`}
          />
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-brand-dark">
          Work Orders ({filteredWorkOrders.length})
        </h2>

        {filteredWorkOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center shadow-sm">
            <ClipboardList className="h-10 w-10 text-neutral-300 mb-4" />
            <p className="text-sm font-medium text-neutral-500">
              No work orders yet
            </p>
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
                    {addresses.length > 0 ? (
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Address
                      </th>
                    ) : null}
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
                  {filteredWorkOrders.map((order) => (
                    <tr key={order._id}>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {formatDate(order.date)}
                      </td>
                      {addresses.length > 0 ? (
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {formatAddressLabel(order.address)}
                        </td>
                      ) : null}
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
                          <StatusBadge
                            label="Completed"
                            active={order.completed}
                          />
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

      <MergeCustomersDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        token={token!}
        survivor={customer}
        onMerged={(merged) => {
          setCustomer({
            ...merged,
            addresses: merged.addresses ?? [],
            contacts: merged.contacts ?? [],
          });
          setMergeToast(
            "Customers merged successfully. Related records were moved here.",
          );
          setAddressFilter("all");
          Promise.all([
            getWorkOrdersForCustomer(token!, merged.legacyId),
            getContractsForCustomer(token!, merged.legacyId),
          ]).then(([orders, { contracts: contractList }]) => {
            setWorkOrders(orders);
            setContracts(contractList);
          });
        }}
      />
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <CustomerDetailContent />
      </Suspense>
    </AuthGuard>
  );
}
