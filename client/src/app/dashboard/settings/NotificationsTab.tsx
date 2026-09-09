"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, authGetMe, updateMyNotifications } from "@/lib/api";

interface NotificationPref {
  id: "generalNotifications" | "billingAlerts" | "smsOptIn";
  label: string;
  description: string;
}

const PREFS: NotificationPref[] = [
  {
    id: "generalNotifications",
    label: "General notifications",
    description:
      "Service reminders, account updates, and other non-billing email.",
  },
  {
    id: "billingAlerts",
    label: "Billing alerts",
    description: "Invoices, receipts, and payment reminders.",
  },
  {
    id: "smsOptIn",
    label: "SMS Alerts",
    description: "Receive text message alerts for urgent updates.",
  },
];

export default function NotificationsTab() {
  const { user, token, login } = useAuthStore();
  const [prefs, setPrefs] = useState({
    generalNotifications: user?.generalNotifications ?? true,
    billingAlerts: user?.billingAlerts ?? true,
    smsOptIn: Boolean(user?.smsOptIn),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    authGetMe(token)
      .then(({ user: fresh }) => {
        if (cancelled) return;
        login(token, fresh);
        setPrefs({
          generalNotifications: fresh.generalNotifications ?? true,
          billingAlerts: fresh.billingAlerts ?? true,
          smsOptIn: Boolean(fresh.smsOptIn),
        });
      })
      .catch(() => {
        if (cancelled || !user) return;
        setPrefs({
          generalNotifications: user.generalNotifications ?? true,
          billingAlerts: user.billingAlerts ?? true,
          smsOptIn: Boolean(user.smsOptIn),
        });
      });
    return () => {
      cancelled = true;
    };
    // Load once when the tab mounts with a token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function toggle(id: NotificationPref["id"]) {
    setSaved(false);
    setError(null);
    setPrefs((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { user: updated } = await updateMyNotifications(token, prefs);
      login(token, updated);
      setPrefs({
        generalNotifications: updated.generalNotifications ?? true,
        billingAlerts: updated.billingAlerts ?? true,
        smsOptIn: Boolean(updated.smsOptIn),
      });
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save preferences.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSave}
      className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-6 text-lg font-semibold text-brand-dark">
        Notifications
      </h2>

      {saved && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Preferences saved.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ul className="divide-y divide-neutral-100">
        {PREFS.map((pref) => (
          <li
            key={pref.id}
            className="flex items-center justify-between gap-4 py-4"
          >
            <div>
              <p className="text-sm font-medium text-brand-dark">{pref.label}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {pref.description}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[pref.id]}
              onClick={() => toggle(pref.id)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                prefs[pref.id] ? "bg-brand-orange" : "bg-neutral-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  prefs[pref.id] ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-6 py-2.5 text-sm disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Preferences"}
        </button>
      </div>
    </form>
  );
}
