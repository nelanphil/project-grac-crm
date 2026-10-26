"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  InboxContext,
  addInboxNote,
  callInboxConversation,
  getInboxContext,
  linkInboxCustomer,
  searchInboxCustomers,
} from "@/lib/api";
import { avatarColor, initials, moneyCents, moneyDollars } from "./inboxFormat";
import { Mail, Phone } from "lucide-react";

type CustomerContextPanelProps = {
  token: string;
  conversationId: string;
  canWrite: boolean;
  refreshKey: number;
  onLinked: (conversationId: string) => void;
  onText: () => void;
  onActivity: () => void;
};

export default function CustomerContextPanel({
  token,
  conversationId,
  canWrite,
  refreshKey,
  onLinked,
  onText,
  onActivity,
}: CustomerContextPanelProps) {
  const [context, setContext] = useState<InboxContext | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<
    { id: string; name: string; phone: string; email: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInboxContext(token, conversationId)
      .then((result) => {
        if (!cancelled) setContext(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load the customer");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, conversationId, refreshKey]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const handle = setTimeout(() => {
      searchInboxCustomers(token, trimmed)
        .then((result) => setMatches(result.customers))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [token, query]);

  async function onNote(event: FormEvent) {
    event.preventDefault();
    if (!note.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await addInboxNote(token, conversationId, note.trim());
      setContext((current) =>
        current ? { ...current, notes: [result.note, ...current.notes] } : current,
      );
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the note");
    } finally {
      setSaving(false);
    }
  }

  async function onLink(customerId: string) {
    setError(null);
    try {
      const result = await linkInboxCustomer(token, conversationId, customerId);
      onLinked(result.conversation.id);
      setQuery("");
      setMatches([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not link the customer");
    }
  }

  const customer = context?.customer;
  const name = customer?.name || "Unknown sender";

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto border-[var(--staff-border)] bg-[var(--staff-surface)] lg:border-l">
      <div className="border-b border-[var(--staff-border)] px-4 py-4 text-center">
        <span
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: avatarColor(name) }}
        >
          {initials(name)}
        </span>
        <h2 className="mt-2 text-base font-semibold text-[var(--staff-ink)]">{name}</h2>
        {customer ? (
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                void callInboxConversation(token, conversationId)
                  .then(() => onActivity())
                  .catch((err: unknown) => {
                    setError(err instanceof ApiError ? err.message : "Call failed");
                  });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
            >
              <Phone className="h-3 w-3" />
              Call
            </button>
            <button
              type="button"
              onClick={onText}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
            >
              <Mail className="h-3 w-3" />
              Text
            </button>
          </div>
        ) : (
          <div className="mt-3 text-left">
            <p className="text-xs text-[var(--staff-muted)]">
              This sender is not on a customer record.
            </p>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Link to customer"
              className="mt-2 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
            />
            {query.trim().length >= 2 && matches.length > 0 ? (
              <ul className="mt-1 overflow-hidden rounded-md border border-[var(--staff-border)]">
                {matches.map((match) => (
                  <li key={match.id}>
                    <button
                      type="button"
                      onClick={() => void onLink(match.id)}
                      className="block w-full px-2 py-1.5 text-left text-xs hover:bg-[var(--staff-cream)]"
                    >
                      <span className="block font-medium text-[var(--staff-ink)]">{match.name}</span>
                      <span className="text-[var(--staff-muted)]">
                        {match.phone || match.email}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      {error ? <p className="px-4 pt-2 text-xs text-red-500">{error}</p> : null}
      {customer ? (
        <div className="space-y-5 px-4 py-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
              Contact
            </h3>
            <Link
              href={`/dashboard/customers/detail?id=${customer.id}`}
              className="mt-1 inline-block text-xs font-medium text-[#2f6fed]"
            >
              Open customer record
            </Link>
            {customer.address ? (
              <p className="mt-1 text-xs text-[var(--staff-ink)]">{customer.address}</p>
            ) : null}
            <ul className="mt-2 space-y-1">
              {(context?.contacts ?? []).map((contact) => (
                <li key={contact.id} className="text-xs text-[var(--staff-ink)]">
                  <span className="font-medium">{contact.name}</span>
                  {contact.isPrimary ? (
                    <span className="ml-1 text-[10px] text-[var(--staff-muted)]">Primary</span>
                  ) : null}
                  {contact.phone ? <p className="text-[var(--staff-muted)]">{contact.phone}</p> : null}
                  {contact.email ? <p className="text-[var(--staff-muted)]">{contact.email}</p> : null}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
              Open work orders
            </h3>
            {(context?.workOrders ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-[var(--staff-muted)]">None</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {context?.workOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/dashboard/work-orders/detail?id=${order.id}`}
                      className="text-xs text-[var(--staff-ink)] hover:underline"
                    >
                      {order.number || "Work order"} · {order.summary}
                      {order.total ? ` · ${moneyDollars(order.total)}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
              Unpaid invoices
            </h3>
            {(context?.invoices ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-[var(--staff-muted)]">None</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {context?.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      href={`/dashboard/orders/detail?id=${invoice.id}`}
                      className="text-xs text-[var(--staff-ink)] hover:underline"
                    >
                      {invoice.number} · {moneyCents(invoice.amountCents)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
              Notes
            </h3>
            <ul className="mt-2 space-y-2">
              {(context?.notes ?? []).map((item) => (
                <li key={item.id} className="rounded-md bg-[var(--staff-cream)] px-2 py-1.5">
                  <p className="whitespace-pre-wrap text-xs text-[var(--staff-ink)]">{item.content}</p>
                  <p className="mt-1 text-[10px] text-[var(--staff-muted)]">
                    {item.authorName || "Staff"} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
            {canWrite ? (
              <form onSubmit={onNote} className="mt-2">
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="Write a note…"
                  className="w-full resize-none rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-xs text-[var(--staff-ink)] outline-none"
                />
                <button
                  type="submit"
                  disabled={saving || !note.trim()}
                  className="mt-1 rounded-md bg-[var(--staff-ink)] px-2 py-1 text-[11px] font-medium text-[var(--staff-surface)] disabled:opacity-50"
                >
                  Add note
                </button>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
