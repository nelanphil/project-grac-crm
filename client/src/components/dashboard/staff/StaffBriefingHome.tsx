"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  ApiError,
  getRecentWorkOrderNotes,
  getReminders,
  type RecentWorkOrderNote,
  type ReminderListItem,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import TechnicianHomeDashboard from "@/components/dashboard/staff/TechnicianHomeDashboard";

const REMINDER_PREVIEW = 4;
const NOTE_PREVIEW = 4;

function ticketHref(item: ReminderListItem): string {
  return item.source === "estimate"
    ? `/dashboard/estimates/detail?id=${item.ticketId}`
    : `/dashboard/work-orders/detail?id=${item.ticketId}`;
}

function excerpt(content: string): string {
  const text = content
    .replace(/\\r\\n|\\n|\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157)}…`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function BriefingCard({
  title,
  count,
  open,
  onToggle,
  action,
  footer,
  wide,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  footer?: ReactNode;
  wide: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] ${
        wide ? "lg:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-3 px-4 lg:border-b lg:border-[var(--staff-border)] lg:py-3">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold uppercase tracking-wide text-[var(--staff-muted)] lg:pointer-events-none lg:min-h-0"
          >
            {title}
            {count != null ? (
              <span className="font-medium text-[var(--staff-ink)]">({count})</span>
            ) : null}
            <ChevronDown
              aria-hidden
              className={`ml-auto h-4 w-4 transition-transform lg:hidden ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div
        className={`${open ? "block" : "hidden"} border-t border-[var(--staff-border)] lg:block lg:border-t-0`}
      >
        <ul className="divide-y divide-[var(--staff-border)]">{children}</ul>
        {footer ? (
          <div className="border-t border-[var(--staff-border)] px-4 py-3 lg:hidden">
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BriefingRow({
  href,
  text,
  meta,
}: {
  href: string;
  text: string;
  meta: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block px-4 py-3.5 hover:bg-[var(--staff-cream)] lg:py-2.5"
      >
        <p className="line-clamp-2 text-sm text-[var(--staff-ink)] lg:line-clamp-1">
          {text}
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--staff-muted)]">
          {meta}
        </p>
      </Link>
    </li>
  );
}

export default function StaffBriefingHome() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const firstName = user?.first_name?.trim() || "";

  const [reminders, setReminders] = useState<ReminderListItem[] | null>(null);
  const [reminderTotal, setReminderTotal] = useState(0);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [notes, setNotes] = useState<RecentWorkOrderNote[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getReminders(token, {
      page: 1,
      pageSize: 50,
      sort: "created",
      dir: "desc",
    })
      .then((result) => {
        if (cancelled) return;
        setReminders(result.reminders.slice(0, REMINDER_PREVIEW));
        setReminderTotal(result.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReminders([]);
        setReminderError(
          err instanceof ApiError ? err.message : "Could not load reminders",
        );
      });
    getRecentWorkOrderNotes(token)
      .then((result) => {
        if (cancelled) return;
        setNotes(result.notes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setNotes([]);
        if (err instanceof ApiError && err.status === 403) return;
        setNotesError(
          err instanceof ApiError ? err.message : "Could not load recent notes",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const hasReminders = Boolean(reminders && reminders.length > 0);
  const hasNotes = Boolean(notes && notes.length > 0);
  const singleCard = hasReminders !== hasNotes;
  const visibleNotes =
    notes && !showAllNotes ? notes.slice(0, NOTE_PREVIEW) : (notes ?? []);
  const canShowMoreNotes = (notes?.length ?? 0) > NOTE_PREVIEW;

  const remindersLink = (
    <Link
      href="/dashboard/notifications"
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      {reminderTotal > (reminders?.length ?? 0)
        ? `See all ${reminderTotal}`
        : "See all"}
    </Link>
  );
  const notesToggle = canShowMoreNotes ? (
    <button
      type="button"
      onClick={() => setShowAllNotes((value) => !value)}
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      {showAllNotes ? "Show less" : "Show more"}
    </button>
  ) : null;
  const notesLink = (
    <Link
      href="/dashboard/notifications/?tab=notes"
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      See all
    </Link>
  );

  const briefing =
    hasReminders || hasNotes || reminderError || notesError ? (
      <div className="order-last grid gap-4 lg:order-none lg:grid-cols-2">
        {reminderError ? (
          <p className="text-sm text-red-700 lg:col-span-2">{reminderError}</p>
        ) : null}
        {notesError ? (
          <p className="text-sm text-red-700 lg:col-span-2">{notesError}</p>
        ) : null}

        {hasReminders && reminders ? (
          <BriefingCard
            title="Reminders"
            count={reminderTotal}
            open={remindersOpen}
            onToggle={() => setRemindersOpen((value) => !value)}
            action={remindersLink}
            footer={remindersLink}
            wide={singleCard}
          >
            {reminders.map((item) => (
              <BriefingRow
                key={`${item.source}-${item.id}`}
                href={ticketHref(item)}
                text={excerpt(item.content)}
                meta={[item.ticketNumber, item.customerName]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </BriefingCard>
        ) : null}

        {hasNotes ? (
          <BriefingCard
            title="Recent notes"
            open={notesOpen}
            onToggle={() => setNotesOpen((value) => !value)}
            action={
              <span className="inline-flex items-center gap-3">
                {notesLink}
                <span className="hidden lg:inline">{notesToggle}</span>
              </span>
            }
            footer={
              <span className="inline-flex items-center gap-3">
                {notesLink}
                {notesToggle}
              </span>
            }
            wide={singleCard}
          >
            {visibleNotes.map((note) => (
              <BriefingRow
                key={note.id}
                href={`/dashboard/work-orders/detail?id=${note.workOrderId}`}
                text={excerpt(note.content)}
                meta={[
                  note.authorName || "Staff",
                  note.ticketNumber,
                  note.customerName,
                  formatWhen(note.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </BriefingCard>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--staff-ink)]">
          {firstName ? `Welcome, ${firstName}` : "Welcome"}
        </h1>
        <p className="mt-1 text-sm text-[var(--staff-muted)]">{todayLabel()}</p>
      </header>

      {briefing}

      <TechnicianHomeDashboard />
    </div>
  );
}
