"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  getPortalHome,
  type PortalAppointment,
  type PortalContract,
  type PortalHome,
  type PortalInvoice,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import {
  formatDateOnly,
  STANDING_LABELS,
  STANDING_STYLES,
} from "@/lib/contractDates";
import PortalAccountCards from "@/components/dashboard/customer/PortalAccountCards";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatAppointmentWhen(item: PortalAppointment): string {
  if (item.scheduledStart) {
    const start = new Date(item.scheduledStart);
    if (!Number.isNaN(start.getTime())) {
      return start.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  if (item.date) return formatDateOnly(item.date);
  return "Date TBD";
}

function appointmentStatus(item: PortalAppointment): string {
  if (item.canceled) return "Canceled";
  if (item.completed) return "Completed";
  return "Scheduled";
}

function invoiceStatusClass(status: PortalInvoice["status"]): string {
  if (status === "paid") return "bg-green-50 text-green-700";
  if (status === "failed") return "bg-red-50 text-red-700";
  if (status === "void") return "bg-neutral-100 text-neutral-500";
  return "bg-amber-50 text-amber-700";
}

const nestedCardClass =
  "rounded-lg border border-neutral-100 bg-neutral-50 p-4";

function AmountDueCard({
  due,
  itemCount,
  loaded,
}: {
  due: number;
  itemCount: number;
  loaded: boolean;
}) {
  return (
    <div className={nestedCardClass}>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Amount due
      </p>
      <p className="mt-1.5 text-xl font-bold text-brand-dark">
        {loaded ? formatMoney(due) : "…"}
      </p>
      {loaded ? (
        <p className="mt-1 text-xs text-neutral-500">
          {itemCount === 0
            ? "Nothing due. Thank you!"
            : `${itemCount} unpaid ${itemCount === 1 ? "item" : "items"}`}
        </p>
      ) : (
        <p className="mt-1 text-xs text-neutral-500">Loading balance…</p>
      )}
      {itemCount > 0 ? (
        <Link
          href="/dashboard/checkout"
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Pay now
        </Link>
      ) : null}
    </div>
  );
}

function ServiceContractCard({
  contracts,
  loaded,
}: {
  contracts: PortalContract[];
  loaded: boolean;
}) {
  return (
    <div className={nestedCardClass}>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Service contract
      </p>
      {!loaded ? (
        <p className="mt-2 text-xs text-neutral-500">Loading contract…</p>
      ) : contracts.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          No service contract on file.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {contracts.map((contract) => (
            <li key={contract._id}>
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-medium text-brand-dark">
                  {contract.templateLabel}
                </p>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STANDING_STYLES[contract.standing]}`}
                >
                  {STANDING_LABELS[contract.standing]}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                {contract.standing === "expired" ? "Expired" : "Renews"}{" "}
                {formatDateOnly(contract.renewalDueDate)}
                {contract.durationMonths
                  ? ` · ${contract.durationMonths}-month`
                  : ""}
              </p>
              {contract.address ? (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {[
                    contract.address.label,
                    contract.address.address,
                    contract.address.city,
                    contract.address.state,
                    contract.address.zip,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppointmentRow({ item }: { item: PortalAppointment }) {
  return (
    <li className="border-t border-neutral-100 py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-dark">
            {formatAppointmentWhen(item)}
          </p>
          <p className="mt-0.5 text-sm text-neutral-600">
            {item.descPerform || item.number || "Service visit"}
          </p>
          {item.tech ? (
            <p className="mt-0.5 text-xs text-neutral-500">{item.tech}</p>
          ) : null}
          {item.addressLabel ? (
            <p className="mt-0.5 text-xs text-neutral-500">{item.addressLabel}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
          {appointmentStatus(item)}
        </span>
      </div>
    </li>
  );
}

export default function CustomerHomeDashboard() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<PortalHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getPortalHome(token)
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load dashboard.",
        ),
      );
  }, [token]);

  const due = data?.balance.totalCents ?? 0;
  const itemCount = data?.balance.items.length ?? 0;
  const upcoming = data?.appointments.upcoming ?? [];
  const recent = data?.appointments.recent ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-neutral-500">Welcome back</p>
            <h2 className="mt-1 text-2xl font-bold text-brand-dark">
              {user?.first_name} {user?.last_name}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">{user?.email}</p>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-[34rem] lg:shrink-0">
            <ServiceContractCard
              contracts={data?.contracts ?? []}
              loaded={Boolean(data)}
            />
            <AmountDueCard due={due} itemCount={itemCount} loaded={Boolean(data)} />
          </div>
        </div>
        {token ? (
          <PortalAccountCards
            customers={data?.customers ?? []}
            token={token}
            loading={!data}
            onCustomersChange={(customers) =>
              setData((prev) => (prev ? { ...prev, customers } : prev))
            }
          />
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-brand-dark">Appointments</h3>
        {!data ? (
          <p className="mt-3 text-sm text-neutral-500">Loading appointments…</p>
        ) : (
          <div className="mt-4 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Upcoming
              </p>
              {upcoming.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">
                  No upcoming appointments.
                </p>
              ) : (
                <ul className="mt-2">
                  {upcoming.map((item) => (
                    <AppointmentRow key={item._id} item={item} />
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Recent
              </p>
              {recent.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">
                  No recent appointments.
                </p>
              ) : (
                <ul className="mt-2">
                  {recent.map((item) => (
                    <AppointmentRow key={item._id} item={item} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-brand-dark">
            Recent invoices
          </h3>
          <Link
            href="/dashboard/orders"
            className="text-sm font-medium text-brand-dark hover:underline"
          >
            All invoices
          </Link>
        </div>
        {!data ? (
          <p className="mt-3 text-sm text-neutral-500">Loading invoices…</p>
        ) : data.invoices.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">No invoices yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100">
            {data.invoices.map((invoice) => (
              <li key={invoice._id}>
                <Link
                  href={`/dashboard/orders/detail?id=${invoice._id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-dark">
                      {invoice.number}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {formatDateOnly(invoice.issuedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${invoiceStatusClass(invoice.status)}`}
                    >
                      {invoice.status}
                    </span>
                    <span className="text-sm font-medium text-brand-dark">
                      {formatMoney(invoice.amountCents)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
