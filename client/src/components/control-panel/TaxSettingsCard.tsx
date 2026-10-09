"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, getTaxSettings, saveTaxSettings } from "@/lib/api";

export default function TaxSettingsCard() {
  const token = useAuthStore((s) => s.token);

  const [rate, setRate] = useState("0");
  const [savedRate, setSavedRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getTaxSettings(token)
      .then(({ settings }) => {
        const value = settings.ratePercent ?? 0;
        setSavedRate(value);
        setRate(String(value));
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load tax settings.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const ratePercent = Number(rate);
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      setSaveError("Tax rate must be between 0 and 100.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const { settings } = await saveTaxSettings(token, { ratePercent });
      setSavedRate(settings.ratePercent);
      setRate(String(settings.ratePercent));
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save tax rate.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-6 py-6 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">Sales tax</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Default rate for new estimates, work orders, and invoices. Changing
            this rate does not rewrite invoices that have already been
            processed.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-neutral-500">Loading tax settings…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 max-w-sm space-y-3">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
              Tax rate (%)
            </span>
            <input
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                setSaved(false);
              }}
              inputMode="decimal"
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </label>
          {saveError ? (
            <p className="text-sm text-red-700">{saveError}</p>
          ) : saved ? (
            <p className="text-sm text-emerald-700">
              Saved {savedRate}% as the default rate.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save tax rate"}
          </button>
        </form>
      )}
    </div>
  );
}
