"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import ConversationPanel from "@/components/messaging/ConversationPanel";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, TwilioAccountItem, getTwilioAccounts } from "@/lib/api";

const ADMIN_ROLES = ["admin", "super-admin", "owner"];

export default function MessagingHistoryPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="text-sm text-neutral-500">Loading history…</div>
        }
      >
        <MessagingHistoryContent />
      </Suspense>
    </AuthGuard>
  );
}

function MessagingHistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contactId = searchParams.get("contactId");

  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);
  const [accountFilterId, setAccountFilterId] = useState("");
  const [sendAccountId, setSendAccountId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isAdmin, router]);

  useEffect(() => {
    if (!token || !isAdmin) return;
    getTwilioAccounts(token)
      .then(({ accounts: list }) => {
        const active = list.filter((a) => a.isActive);
        setAccounts(active);
        if (active.length > 0) {
          setSendAccountId((prev) => prev || active[0]._id);
          const nums = active[0].phoneNumbers ?? [];
          if (nums.length > 0) {
            setFromNumber((prev) => prev || nums[0]);
          }
        }
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load Twilio accounts.",
        ),
      );
  }, [token, isAdmin]);

  const selectedAccount = accounts.find((a) => a._id === sendAccountId);
  const fromOptions = selectedAccount?.phoneNumbers ?? [];
  const effectiveFromNumber = fromOptions.includes(fromNumber)
    ? fromNumber
    : (fromOptions[0] ?? "");

  if (!user || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">
          Conversation history
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Review SMS, MMS, and voice activity by contact, scoped to Twilio
          accounts.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            History account filter
          </span>
          <select
            value={accountFilterId}
            onChange={(e) => setAccountFilterId(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.friendlyName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Call from account
          </span>
          <select
            value={sendAccountId}
            onChange={(e) => setSendAccountId(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          >
            {accounts.length === 0 ? (
              <option value="">No active accounts</option>
            ) : (
              accounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.friendlyName}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            From number
          </span>
          <select
            value={effectiveFromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          >
            {fromOptions.length === 0 ? (
              <option value="">No numbers</option>
            ) : (
              fromOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      {token ? (
        <ConversationPanel
          token={token}
          twilioAccountId={accountFilterId}
          fromNumber={effectiveFromNumber}
          focusedContactId={contactId}
        />
      ) : null}
    </div>
  );
}
