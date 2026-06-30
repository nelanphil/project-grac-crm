"use client";

import { useState } from "react";

interface NotificationPref {
  id: string;
  label: string;
  description: string;
}

const PREFS: NotificationPref[] = [
  { id: "email_alerts", label: "Email Alerts", description: "Receive notifications via email for new leads and account activity." },
  { id: "sms_alerts", label: "SMS Alerts", description: "Receive text message alerts for urgent updates." },
];

export default function NotificationsTab() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PREFS.map((p) => [p.id, false]))
  );
  const [saved, setSaved] = useState(false);

  function toggle(id: string) {
    setSaved(false);
    setPrefs((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleSave() {
    // Persisted locally for now — backend integration can be added later
    setSaved(true);
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-brand-dark mb-6">Notifications</h2>

      {saved && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Preferences saved.
        </div>
      )}

      <ul className="divide-y divide-neutral-100">
        {PREFS.map((pref) => (
          <li key={pref.id} className="flex items-center justify-between gap-4 py-4">
            <div>
              <p className="text-sm font-medium text-brand-dark">{pref.label}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{pref.description}</p>
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
        <button onClick={handleSave} className="btn-primary px-6 py-2.5 text-sm">
          Save Preferences
        </button>
      </div>
    </div>
  );
}
