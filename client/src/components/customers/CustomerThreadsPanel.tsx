"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  ApiError,
  CustomerContact,
  MessageThreadItem,
  getMessagingThreads,
} from "@/lib/api";
import { formatCustomerName, toProperCase } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";
import { formatTime } from "@/components/messaging/MessageBubble";

type CustomerThreadsPanelProps = {
  customerId: string;
  contacts: CustomerContact[];
  token: string;
};

export default function CustomerThreadsPanel({
  customerId,
  contacts,
  token,
}: CustomerThreadsPanelProps) {
  const isAdmin = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );

  const [threads, setThreads] = useState<MessageThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getMessagingThreads(token, { customerId, pageSize: 100 })
      .then((res) => {
        if (cancelled) return;
        setThreads(res.threads);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load threads.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, customerId, isAdmin]);

  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contacts) {
      map.set(
        c._id,
        formatCustomerName(c.first, c.last) || c.phone || "Contact",
      );
    }
    return map;
  }, [contacts]);

  const threadsByContact = useMemo(() => {
    const map = new Map<string, MessageThreadItem[]>();
    for (const t of threads) {
      const list = map.get(t.contactRef) ?? [];
      list.push(t);
      map.set(t.contactRef, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return (
          new Date(b.lastMessageAt ?? 0).getTime() -
          new Date(a.lastMessageAt ?? 0).getTime()
        );
      });
    }
    return map;
  }, [threads]);

  if (!isAdmin) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-brand-dark">
        Message threads
      </h2>

      {error ? (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading threads…
        </div>
      ) : threads.length === 0 ? (
        <p className="py-6 text-sm text-neutral-500">
          No message threads started with this customer yet.
        </p>
      ) : (
        <div className="space-y-4">
          {[...threadsByContact.entries()].map(([contactId, contactThreads]) => (
            <div key={contactId}>
              <h3 className="mb-2 text-sm font-medium text-neutral-600">
                {contactNameById.get(contactId) || "Contact"}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {contactThreads.map((t) => (
                  <li key={t._id}>
                    <Link
                      href={`/dashboard/messaging?tab=threads&threadId=${t._id}`}
                      className="block rounded-lg border border-neutral-200 px-3 py-2 hover:border-brand-orange"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-neutral-500">
                          {t.ourNumber}
                          {t.accountFriendlyName
                            ? ` · ${toProperCase(t.accountFriendlyName)}`
                            : ""}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            t.status === "open"
                              ? "bg-green-50 text-green-700"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-brand-dark">
                        {t.lastMessagePreview || "(no messages)"}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-400">
                        <span>{formatTime(t.lastMessageAt) || "—"}</span>
                        <span>
                          {t.messageCount} message
                          {t.messageCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
