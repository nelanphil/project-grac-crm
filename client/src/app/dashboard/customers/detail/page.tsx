"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  GitMerge,
  Loader2,
  Pencil,
  Plus,
  ScrollText,
  X,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ContactCard from "@/components/customers/ContactCard";
import CommunicationHistoryPanel from "@/components/customers/CommunicationHistoryPanel";
import CustomerThreadsPanel from "@/components/customers/CustomerThreadsPanel";
import CustomerAddressesPanel, {
  addressesSectionTitle,
  formatAddressLabel,
} from "@/components/customers/CustomerAddressesPanel";
import MergeCustomersDialog from "@/components/customers/MergeCustomersDialog";
import ServiceContractsTable from "@/components/contracts/ServiceContractsTable";
import MobileSectionNav from "@/components/ui/MobileSectionNav";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getCustomer,
  getWorkOrdersForCustomer,
  getContractsForCustomer,
  createInvoice,
  createInvoicePayLink,
  updateCustomer,
  promoteCustomer,
  CustomerDetail,
  WorkOrderListItem,
  ContractListItem,
  ApiError,
} from "@/lib/api";
import { formatCustomerRecordName } from "@/lib/formatName";

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

function WorkOrderInvoiceButton({
  token,
  workOrderId,
}: {
  token: string;
  workOrderId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    try {
      let invoiceId: string;
      try {
        const { invoice } = await createInvoice(token, {
          sourceType: "work_order",
          workOrderRef: workOrderId,
        });
        invoiceId = invoice._id;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const { getInvoices } = await import("@/lib/api");
          const { invoices } = await getInvoices(token, {
            workOrderRef: workOrderId,
            status: "open",
          });
          if (!invoices[0]) throw err;
          invoiceId = invoices[0]._id;
        } else {
          throw err;
        }
      }
      const { payUrl } = await createInvoicePayLink(token, invoiceId);
      await navigator.clipboard?.writeText(payUrl);
      setMessage("Pay link copied");
    } catch (err) {
      setMessage(
        err instanceof ApiError ? err.message : "Failed to create invoice",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
      >
        {busy ? "…" : "Invoice & link"}
      </button>
      {message ? (
        <div className="mt-1 text-[10px] text-neutral-500 max-w-[12rem] break-words">
          {message}
        </div>
      ) : null}
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
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWrite = useAuthStore((s) => s.hasPermission("customers:write"));
  const canWriteJobs = useAuthStore((s) => s.hasPermission("jobs:write"));

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderListItem[]>([]);
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [addressFilter, setAddressFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeToast, setMergeToast] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

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
  const isAdmin = user.role === "admin";
  const sectionLinks = [
    { id: "customer-overview", label: "Overview" },
    { id: "customer-addresses", label: "Addresses" },
    ...(isAdmin
      ? [
          { id: "customer-threads", label: "Threads" },
          { id: "customer-history", label: "History" },
        ]
      : []),
    { id: "customer-contracts", label: "Contracts" },
    { id: "customer-work-orders", label: "Work orders" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            href="/dashboard/customers"
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Customers
          </Link>
          <h1 className="mt-4 text-xl font-bold text-brand-dark sm:text-2xl break-words">
            {editingName ? (
              <span className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="w-full min-w-0 rounded-md border border-neutral-200 px-3 py-1.5 text-lg font-bold outline-none focus:border-brand-orange sm:max-w-md sm:text-xl"
                  autoFocus
                />
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={savingName}
                    onClick={async () => {
                      if (!token || !customer) return;
                      setSavingName(true);
                      setNameError(null);
                      try {
                        const { customer: updated } = await updateCustomer(
                          token,
                          customer._id,
                          { accountName: nameDraft.trim() },
                        );
                        setCustomer((c) =>
                          c
                            ? {
                                ...c,
                                accountName:
                                  updated.accountName ?? nameDraft.trim(),
                              }
                            : c,
                        );
                        setEditingName(false);
                      } catch (err) {
                        setNameError(
                          err instanceof ApiError
                            ? err.message
                            : "Failed to update account name.",
                        );
                      } finally {
                        setSavingName(false);
                      }
                    }}
                    className="rounded-md bg-brand-dark p-1.5 text-white hover:bg-brand-dark/90 disabled:opacity-60"
                    aria-label="Save account name"
                  >
                    {savingName ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={savingName}
                    onClick={() => {
                      setEditingName(false);
                      setNameError(null);
                    }}
                    className="rounded-md border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-50"
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </span>
              </span>
            ) : (
              <span className="inline-flex items-start gap-2">
                <span className="min-w-0">
                  {formatCustomerRecordName(customer)}
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(
                        customer.accountName?.trim() ||
                          formatCustomerRecordName(customer),
                      );
                      setEditingName(true);
                      setNameError(null);
                    }}
                    className="mt-0.5 shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark"
                    aria-label="Edit account name"
                    title="Edit account name"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                ) : null}
              </span>
            )}
          </h1>
          {nameError ? (
            <p className="mt-1 text-sm text-red-600">{nameError}</p>
          ) : null}
          <p className="mt-1 hidden text-sm text-neutral-500 sm:block">
            Customer details, addresses, and work order history
          </p>
          <div className="mt-2 flex flex-col gap-1 text-sm text-neutral-600 sm:flex-row sm:flex-wrap sm:gap-x-3">
            <p>
              <span className="font-medium text-neutral-500">Owner:</span>{" "}
              {customer.owner
                ? `${customer.owner.first_name} ${customer.owner.last_name}`.trim()
                : "Unassigned"}
            </p>
            <p>
              <span className="font-medium text-neutral-500">County:</span>{" "}
              {customer.county?.trim() || "—"}
            </p>
          </div>
          {customer.isTemporary ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge label="Temporary Lead" active={false} />
              {promoteError ? (
                <span className="text-xs text-red-600">{promoteError}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {canWrite && customer.isTemporary ? (
            <button
              type="button"
              disabled={promoting}
              onClick={async () => {
                if (!token || !customer) return;
                setPromoting(true);
                setPromoteError(null);
                try {
                  await promoteCustomer(token, customer._id);
                  setCustomer((c) => (c ? { ...c, isTemporary: false } : c));
                } catch (err) {
                  setPromoteError(
                    err instanceof ApiError
                      ? err.message
                      : "Failed to promote customer.",
                  );
                } finally {
                  setPromoting(false);
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange disabled:opacity-60 sm:w-auto"
            >
              {promoting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Promote to full customer
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={() => setMergeOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange sm:w-auto"
            >
              <GitMerge className="h-4 w-4" />
              Merge customer
            </button>
          ) : null}
        </div>
      </div>

      <MobileSectionNav sections={sectionLinks} />

      {mergeToast ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {mergeToast}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section id="customer-overview" className="scroll-mt-28 lg:scroll-mt-6">
          <ContactCard
            customer={customer}
            token={token!}
            userId={user.id}
            canWrite={canWrite}
            onCustomerChange={setCustomer}
          />
        </section>
        <section
          id="customer-addresses"
          className="scroll-mt-28 space-y-3 lg:col-span-2 lg:scroll-mt-6"
        >
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
        </section>
      </div>

      <section id="customer-threads" className="scroll-mt-28 lg:scroll-mt-6">
        <CustomerThreadsPanel
          customerId={customer._id}
          contacts={customer.contacts ?? []}
          token={token!}
        />
      </section>

      <section id="customer-history" className="scroll-mt-28 lg:scroll-mt-6">
        <CommunicationHistoryPanel
          customerId={customer._id}
          contacts={customer.contacts ?? []}
          token={token!}
        />
      </section>

      {addresses.length > 1 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
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
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange sm:w-auto sm:py-1.5"
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

      <section
        id="customer-contracts"
        className="scroll-mt-28 space-y-4 lg:scroll-mt-6"
      >
        <h2 className="text-lg font-semibold text-brand-dark">
          Contracts ({filteredContracts.length})
        </h2>

        {filteredContracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-12 text-center shadow-sm">
            <ScrollText className="mb-4 h-10 w-10 text-neutral-300" />
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
      </section>

      <section
        id="customer-work-orders"
        className="scroll-mt-28 space-y-4 lg:scroll-mt-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-brand-dark">
            Work Orders ({filteredWorkOrders.length})
          </h2>
          {canWriteJobs ? (
            <Link
              href={`/dashboard/work-orders/create?customerId=${customer._id}`}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              New work order
            </Link>
          ) : null}
        </div>

        {filteredWorkOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center shadow-sm">
            <ClipboardList className="mb-4 h-10 w-10 text-neutral-300" />
            <p className="text-sm font-medium text-neutral-500">
              No work orders yet
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              Work orders for this customer will appear here.
            </p>
            {canWriteJobs ? (
              <Link
                href={`/dashboard/work-orders/create?customerId=${customer._id}`}
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-orange hover:underline"
              >
                Create a work order
              </Link>
            ) : null}
          </div>
        ) : (
          <ResponsiveDataView
            mobile={filteredWorkOrders.map((order) => (
              <MobileDataCard
                key={order._id}
                title={formatDate(order.date)}
                subtitle={
                  addresses.length > 0
                    ? formatAddressLabel(order.address)
                    : undefined
                }
                onClick={() =>
                  router.push(`/dashboard/work-orders/detail?id=${order._id}`)
                }
                badges={
                  <>
                    <StatusBadge label="Paid" active={order.paid} />
                    <StatusBadge label="Completed" active={order.completed} />
                  </>
                }
                fields={
                  <>
                    <DataField
                      label="Description"
                      value={order.descPerform || order.descPerformed || "—"}
                      className="col-span-2"
                    />
                    <DataField label="Technician" value={order.tech || "—"} />
                    <DataField
                      label="Total"
                      value={formatCurrency(order.total)}
                    />
                  </>
                }
                actions={
                  !order.paid && order.total > 0 && token ? (
                    <WorkOrderInvoiceButton
                      token={token}
                      workOrderId={order._id}
                    />
                  ) : null
                }
              />
            ))}
            desktop={
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
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
                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                          Billing
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 bg-white">
                      {filteredWorkOrders.map((order) => (
                        <tr
                          key={order._id}
                          className="cursor-pointer hover:bg-neutral-50"
                          onClick={() =>
                            router.push(
                              `/dashboard/work-orders/detail?id=${order._id}`,
                            )
                          }
                        >
                          <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                            {formatDate(order.date)}
                          </td>
                          {addresses.length > 0 ? (
                            <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                              {formatAddressLabel(order.address)}
                            </td>
                          ) : null}
                          <td className="px-6 py-4 text-neutral-600">
                            {order.descPerform || order.descPerformed || "—"}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                            {order.tech || "—"}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                            {formatCurrency(order.total)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex gap-2">
                              <StatusBadge label="Paid" active={order.paid} />
                              <StatusBadge
                                label="Completed"
                                active={order.completed}
                              />
                            </div>
                          </td>
                          <td
                            className="whitespace-nowrap px-6 py-4 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!order.paid && order.total > 0 && token ? (
                              <WorkOrderInvoiceButton
                                token={token}
                                workOrderId={order._id}
                              />
                            ) : (
                              <span className="text-xs text-neutral-400">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            }
          />
        )}
      </section>

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
