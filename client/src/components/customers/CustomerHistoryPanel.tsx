"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  History,
  LogIn,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  Receipt,
  ScrollText,
  StickyNote,
  UserRound,
  Wrench,
} from "lucide-react";
import type { CustomerActivityItem } from "@/lib/api";
import { activityHref, isCustomerPageHref } from "@/lib/activityLinks";
import {
  ALL_HISTORY_KEY,
  useCustomerHistoryStore,
  type HistoryFilters,
} from "@/store/useCustomerHistoryStore";

const CATEGORIES: { id: string; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "contact", label: "Contacts" },
  { id: "address", label: "Addresses" },
  { id: "equipment", label: "Equipment" },
  { id: "work_order", label: "Work orders" },
  { id: "contract", label: "Contracts" },
  { id: "estimate", label: "Estimates" },
  { id: "invoice", label: "Invoices" },
  { id: "payment", label: "Payments" },
  { id: "communication", label: "Messages" },
  { id: "note", label: "Notes" },
  { id: "auth", label: "Sign-in" },
  { id: "portal", label: "Portal" },
];

const ACTORS: { id: string | null; label: string }[] = [
  { id: null, label: "Anyone" },
  { id: "staff", label: "Staff" },
  { id: "customer", label: "Customer" },
  { id: "system", label: "System" },
];

function CategoryIcon({ category }: { category: string }) {
  const className = "h-4 w-4";
  switch (category) {
    case "contact":
      return <UserRound className={className} aria-hidden />;
    case "address":
      return <MapPin className={className} aria-hidden />;
    case "equipment":
      return <Wrench className={className} aria-hidden />;
    case "work_order":
      return <ClipboardList className={className} aria-hidden />;
    case "contract":
      return <ScrollText className={className} aria-hidden />;
    case "estimate":
      return <FileText className={className} aria-hidden />;
    case "invoice":
      return <Receipt className={className} aria-hidden />;
    case "payment":
      return <CreditCard className={className} aria-hidden />;
    case "communication":
      return <MessageSquare className={className} aria-hidden />;
    case "note":
      return <StickyNote className={className} aria-hidden />;
    case "auth":
      return <LogIn className={className} aria-hidden />;
    case "portal":
      return <Building2 className={className} aria-hidden />;
    default:
      return <History className={className} aria-hidden />;
  }
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "";
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) {
    return minutes > 0 ? `${minutes}m ago` : `in ${Math.abs(minutes)}m`;
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return hours > 0 ? `${hours}h ago` : `in ${Math.abs(hours)}h`;
  }
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 14) {
    return days > 0 ? `${days}d ago` : `in ${Math.abs(days)}d`;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function exactTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function displayValue(value: unknown): string {
  if (value == null || value === "") return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function customerHistoryHref(customerRef: string): string {
  const params = new URLSearchParams({ id: customerRef, tab: "history" });
  return `/dashboard/customers/detail?${params.toString()}`;
}

function HistoryRow({
  item,
  fresh,
  href,
  onNavigate,
  showCustomer,
  samePageLinks,
}: {
  item: CustomerActivityItem;
  fresh: boolean;
  href: string | null;
  onNavigate: (href?: string) => void;
  showCustomer: boolean;
  samePageLinks: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasChanges = item.changes.length > 0;
  const summary = href ? (
    <Link
      href={href}
      onClick={(event) => {
        if (samePageLinks && isCustomerPageHref(href)) {
          event.preventDefault();
          onNavigate(href);
          return;
        }
        onNavigate();
      }}
      className="inline-flex items-start gap-1 text-sm font-medium text-neutral-900 underline-offset-2 hover:text-brand-orange hover:underline"
    >
      <span>{item.summary}</span>
      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
    </Link>
  ) : (
    <p className="text-sm font-medium text-neutral-900">{item.summary}</p>
  );
  return (
    <li
      className={`rounded-lg border px-3 py-3 ${
        fresh
          ? "border-brand-orange bg-orange-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
          <CategoryIcon category={item.category} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {summary}
            <time
              dateTime={item.createdAt}
              title={exactTime(item.createdAt)}
              className="shrink-0 text-xs text-neutral-500"
            >
              {relativeTime(item.createdAt)}
            </time>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span
              className={`rounded-full px-1.5 py-0.5 font-medium ${
                item.actorKind === "customer"
                  ? "bg-sky-100 text-sky-800"
                  : item.actorKind === "staff"
                    ? "bg-neutral-200 text-neutral-700"
                    : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {item.actorKind === "customer"
                ? "Customer"
                : item.actorKind === "staff"
                  ? "Staff"
                  : "System"}
            </span>
            <span>{item.actorName}</span>
            {showCustomer && item.customerRef ? (
              <Link
                href={customerHistoryHref(item.customerRef)}
                onClick={() => onNavigate()}
                className="font-medium text-brand-orange hover:underline"
              >
                {item.customerName || "Customer"}
              </Link>
            ) : null}
            {item.backfilled ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                Reconstructed
              </span>
            ) : null}
          </div>
          {hasChanges ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="mt-2 text-xs font-medium text-brand-orange hover:underline"
            >
              {open ? "Hide changes" : `${item.changes.length} field change${item.changes.length === 1 ? "" : "s"}`}
            </button>
          ) : null}
          {open ? (
            <ul className="mt-2 space-y-1 text-xs text-neutral-600">
              {item.changes.map((change) => (
                <li key={change.field}>
                  <span className="font-medium capitalize">{fieldLabel(change.field)}</span>
                  {": "}
                  <span className="line-through">{displayValue(change.from)}</span>
                  {" → "}
                  <span>{displayValue(change.to)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

const PREVIEW_LIMIT = 5;

function groupByDay(items: CustomerActivityItem[]) {
  const rows: { day: string; items: CustomerActivityItem[] }[] = [];
  for (const item of items) {
    const day = dayKey(item.createdAt);
    const last = rows[rows.length - 1];
    if (!last || last.day !== day) rows.push({ day, items: [item] });
    else last.items.push(item);
  }
  return rows;
}

function HistoryList({
  groups,
  freshIds,
  customerId,
  onNavigate,
  showCustomer,
  samePageLinks,
}: {
  groups: { day: string; items: CustomerActivityItem[] }[];
  freshIds: string[];
  customerId: string;
  onNavigate: (href?: string) => void;
  showCustomer: boolean;
  samePageLinks: boolean;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {group.day}
          </h3>
          <ul className="space-y-2">
            {group.items.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                fresh={freshIds.includes(item.id) && !item.backfilled}
                href={activityHref(item, showCustomer ? item.customerRef : customerId)}
                onNavigate={onNavigate}
                showCustomer={showCustomer}
                samePageLinks={samePageLinks}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function CustomerHistoryPanel({
  customerId,
  token,
  active,
  scope = "customer",
  showHeader = true,
  expanded: expandedProp,
  onExpandedChange,
}: {
  customerId?: string;
  token: string;
  active: boolean;
  scope?: "customer" | "all";
  showHeader?: boolean;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const bucketKey = scope === "all" ? ALL_HISTORY_KEY : (customerId ?? "");
  const allCustomers = scope === "all";
  const bucket = useCustomerHistoryStore((state) => state.byCustomer[bucketKey]);
  const connect = useCustomerHistoryStore((state) => state.connect);
  const disconnect = useCustomerHistoryStore((state) => state.disconnect);
  const filters = useCustomerHistoryStore((state) => state.filters);
  const loadInitial = useCustomerHistoryStore((state) => state.loadInitial);
  const loadMore = useCustomerHistoryStore((state) => state.loadMore);
  const setFilters = useCustomerHistoryStore((state) => state.setFilters);
  const setWatching = useCustomerHistoryStore((state) => state.setWatching);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [asOf] = useState(() => new Date().toISOString());
  const expanded = expandedProp ?? internalExpanded;
  function setExpanded(open: boolean) {
    onExpandedChange?.(open);
    if (expandedProp === undefined) setInternalExpanded(open);
  }
  const items = useMemo(() => {
    if (!bucket) return [];
    const rows = bucket.order
      .map((id) => bucket.byId[id])
      .filter((item): item is CustomerActivityItem => Boolean(item));
    if (!allCustomers) return rows;
    return rows.filter((item) => item.createdAt <= asOf);
  }, [allCustomers, asOf, bucket]);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const newestId = items[0]?.id;
  const seenNewest = useRef<string | null>(null);

  useEffect(() => {
    if (!active || bucket?.loaded || bucket?.loading) return;
    loadInitial(token, bucketKey);
  }, [active, bucket?.loaded, bucket?.loading, bucketKey, loadInitial, token]);

  useEffect(() => {
    if (!allCustomers || !active) return;
    connect(token, bucketKey);
    return () => disconnect(bucketKey);
  }, [active, allCustomers, bucketKey, connect, disconnect, token]);

  useEffect(() => {
    setWatching(bucketKey, active || expanded);
  }, [active, bucketKey, expanded, setWatching]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onExpandedChange?.(false);
      if (expandedProp === undefined) setInternalExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [expanded, expandedProp, onExpandedChange]);

  useEffect(() => {
    if (!newestId || !active) return;
    if (seenNewest.current == null) {
      seenNewest.current = newestId;
      return;
    }
    if (seenNewest.current === newestId) return;
    seenNewest.current = newestId;
    setFreshIds((current) => [newestId, ...current].slice(0, 8));
    const timer = window.setTimeout(() => {
      setFreshIds((current) => current.filter((id) => id !== newestId));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [newestId, active]);

  const previewGroups = useMemo(
    () => groupByDay(allCustomers ? items : items.slice(0, PREVIEW_LIMIT)),
    [allCustomers, items],
  );
  const groups = useMemo(() => groupByDay(items), [items]);

  function toggleCategory(id: string) {
    const categories = filters.categories.includes(id)
      ? filters.categories.filter((value) => value !== id)
      : [...filters.categories, id];
    const next: HistoryFilters = { ...filters, categories };
    setFilters(token, bucketKey, next);
  }

  const live = bucket?.live ?? "off";
  const liveLabel =
    live === "open" ? "Live" : live === "retrying" ? "Reconnecting" : "Connecting";

  function openActivity(href?: string) {
    setExpanded(false);
    if (!allCustomers && href && isCustomerPageHref(href)) {
      router.replace(href, { scroll: false });
    }
  }

  const status = (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          live === "open"
            ? "bg-emerald-500"
            : live === "off"
              ? "bg-neutral-300"
              : "bg-amber-500"
        }`}
        aria-hidden
      />
      {liveLabel}
    </div>
  );

  const filtersBar = (
    <>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {ACTORS.map((actor) => {
          const selected = filters.actorKind === actor.id;
          return (
            <button
              key={actor.label}
              type="button"
              onClick={() =>
                setFilters(token, bucketKey, {
                  ...filters,
                  actorKind: actor.id,
                })
              }
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                selected
                  ? "bg-brand-orange text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {actor.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {CATEGORIES.map((category) => {
          const selected = filters.categories.includes(category.id);
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => toggleCategory(category.id)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                selected
                  ? "bg-neutral-800 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {category.label}
            </button>
          );
        })}
      </div>
    </>
  );

  const emptyState =
    !bucket?.loading && items.length === 0 && bucket?.loaded ? (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 py-12 text-center">
        <History className="mb-4 h-10 w-10 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-500">No history yet</p>
        <p className="mt-1 text-xs text-neutral-400">
          Staff and customer actions will show up here as they happen.
        </p>
      </div>
    ) : null;

  const overlay =
    expanded && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={allCustomers ? "Expanded customer log" : "Expanded history"}
            className="fixed inset-0 z-[60] flex h-dvh w-dvw flex-col overflow-hidden bg-white p-3 text-brand-dark shadow-2xl sm:p-5"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 pb-3">
              <div className="flex min-w-0 items-center gap-2">
                <History className="h-5 w-5 text-brand-orange" aria-hidden />
                <span className="font-semibold text-brand-dark">
                  {allCustomers ? "Customer Log" : "History"}
                </span>
                {status}
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Exit full screen (Esc)"
                aria-label="Exit full screen"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-brand-dark shadow-2xs transition-colors hover:bg-neutral-200"
              >
                <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                <span>Exit Fullscreen</span>
                <kbd className="ml-1 hidden rounded bg-neutral-200/60 px-1 font-mono text-[10px] text-neutral-400 sm:inline">
                  Esc
                </kbd>
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-3">
              {filtersBar}
              {bucket?.error ? (
                <p className="text-sm text-red-600">{bucket.error}</p>
              ) : null}
              {bucket?.loading && items.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  Loading history…
                </p>
              ) : null}
              {emptyState}
              <HistoryList
                groups={groups}
                freshIds={freshIds}
                customerId={bucketKey}
                onNavigate={openActivity}
                showCustomer={allCustomers}
                samePageLinks={!allCustomers}
              />
              {bucket?.nextCursor ? (
                <button
                  type="button"
                  onClick={() => loadMore(token, bucketKey)}
                  disabled={bucket.loadingMore}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                >
                  {bucket.loadingMore ? "Loading…" : "Load older"}
                </button>
              ) : items.length > 0 ? (
                <p className="text-center text-xs text-neutral-400">
                  Earlier activity may be incomplete.
                </p>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-4">
      {showHeader ? (
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 pb-2">
        {status}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Expand history to full screen"
          aria-label="Expand history to full screen"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-100 hover:text-brand-dark"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Expand</span>
        </button>
      </div>
      ) : null}

      {bucket?.error ? (
        <p className="text-sm text-red-600">{bucket.error}</p>
      ) : null}

      {bucket?.loading && items.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">Loading history…</p>
      ) : null}

      {emptyState}
      <HistoryList
        groups={previewGroups}
        freshIds={freshIds}
        customerId={bucketKey}
        onNavigate={openActivity}
        showCustomer={allCustomers}
        samePageLinks={!allCustomers}
      />
      {overlay}
    </div>
  );
}
