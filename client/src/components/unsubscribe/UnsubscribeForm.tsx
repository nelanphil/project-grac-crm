"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  getPublicEmailPreferences,
  updatePublicEmailPreferences,
} from "@/lib/api";

function ReenableNote() {
  return (
    <p className="mt-1 text-xs text-neutral-500">
      <Link
        href="/dashboard/settings?tab=notifications"
        className="font-medium text-brand-orange hover:underline"
      >
        Log in to turn this back on
      </Link>
    </p>
  );
}

function Switch({
  checked,
  onChange,
  highlight,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  highlight?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        checked ? "bg-brand-orange" : "bg-neutral-200"
      } ${highlight ? "ring-2 ring-brand-orange ring-offset-2" : ""} ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function UnsubscribeForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState<"general" | "billing" | null>(null);
  const [generalNotifications, setGeneralNotifications] = useState(true);
  const [billingAlerts, setBillingAlerts] = useState(true);
  const [generalLocked, setGeneralLocked] = useState(false);
  const [billingLocked, setBillingLocked] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(token));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    token
      ? null
      : "This unsubscribe link is missing a token. Use the link from your email.",
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    getPublicEmailPreferences(token)
      .then((prefs) => {
        if (cancelled) return;
        setEmail(prefs.email);
        setGeneralNotifications(prefs.generalNotifications);
        setBillingAlerts(prefs.billingAlerts);
        setGeneralLocked(!prefs.generalNotifications);
        setBillingLocked(!prefs.billingAlerts);
        setChannel(prefs.channel ?? "general");
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "This unsubscribe link is invalid or has expired.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const prefs = await updatePublicEmailPreferences(token, {
        generalNotifications,
        billingAlerts,
      });
      setGeneralNotifications(prefs.generalNotifications);
      setBillingAlerts(prefs.billingAlerts);
      setGeneralLocked(!prefs.generalNotifications);
      setBillingLocked(!prefs.billingAlerts);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not save your preferences. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-center text-sm text-neutral-500">Loading preferences…</p>
    );
  }

  if (error && !email) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Preferences saved for {email}.
        </div>
      ) : (
        <p className="text-sm text-neutral-600">
          Preferences for <span className="font-medium text-brand-dark">{email}</span>
        </p>
      )}

      <ul className="divide-y divide-neutral-100">
        <li className="flex items-start justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-brand-dark">
              General notifications
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Service reminders, account updates, and other non-billing email.
            </p>
            {generalLocked ? <ReenableNote /> : null}
          </div>
          <Switch
            checked={generalNotifications}
            disabled={generalLocked}
            onChange={() => {
              if (generalLocked) return;
              setSaved(false);
              setGeneralNotifications((value) => !value);
            }}
            highlight={channel === "general"}
          />
        </li>
        <li className="flex items-start justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-brand-dark">Billing alerts</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Invoices, receipts, and payment reminders.
            </p>
            {billingLocked ? <ReenableNote /> : null}
          </div>
          <Switch
            checked={billingAlerts}
            disabled={billingLocked}
            onChange={() => {
              if (billingLocked) return;
              setSaved(false);
              setBillingAlerts((value) => !value);
            }}
            highlight={channel === "billing"}
          />
        </li>
      </ul>

      <button
        type="submit"
        disabled={saving}
        className="btn-primary w-full py-2.5 text-sm disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}
