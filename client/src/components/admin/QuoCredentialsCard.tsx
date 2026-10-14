"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
  ApiError,
  QuoCredentialsItem,
  deleteQuoCredentials,
  getQuoCredentials,
  saveQuoCredentials,
} from "@/lib/api";

const EMPTY_CREDENTIALS = {
  apiKey: "",
  label: "",
  isActive: true,
};

export default function QuoCredentialsCard({
  token,
}: {
  token: string | null;
}) {
  const [credentials, setCredentials] = useState<QuoCredentialsItem | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [form, setForm] = useState(EMPTY_CREDENTIALS);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { credentials: item } = await getQuoCredentials(token!);
        if (!cancelled) setCredentials(item);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load Quo settings.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function openForm() {
    setForm({
      apiKey: "",
      label: credentials?.label ?? "",
      isActive: credentials?.isActive ?? true,
    });
    setSaveError(null);
    setShowApiKey(false);
    setFormOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (!credentials && !form.apiKey.trim()) {
      setSaveError("API key is required the first time.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const { credentials: saved } = await saveQuoCredentials(token, {
        apiKey: form.apiKey.trim() || undefined,
        label: form.label.trim(),
        isActive: form.isActive,
      });
      setCredentials(saved);
      setFormOpen(false);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save Quo credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!token || !credentials) return;
    if (
      !window.confirm(
        "Remove the Quo API key? Quo API calls will no longer work.",
      )
    )
      return;

    setSaving(true);
    try {
      await deleteQuoCredentials(token);
      setCredentials(null);
      setFormOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete Quo settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading Quo settings…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-100 p-2 text-violet-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">
              Quo credentials
            </h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              API key from your Quo workspace settings. Used for Quo API calls.
              The key is stored encrypted and is never shown again after save.
            </p>
          </div>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openForm}
            className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            {credentials ? "Edit" : "Add credentials"}
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen ? (
        <form
          onSubmit={onSubmit}
          className="space-y-4 border-b border-neutral-100 px-6 py-5"
        >
          {saveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Workspace label
              </span>
              <input
                value={form.label}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, label: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Optional name"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                API key
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, apiKey: e.target.value }))
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                  placeholder={
                    credentials
                      ? "leave blank to keep current"
                      : "Quo API key"
                  }
                  required={!credentials}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  className="rounded-md border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, isActive: e.target.checked }))
              }
            />
            Enable Quo API calls
          </label>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              {credentials && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  {saving ? "Removing…" : "Delete"}
                </button>
              )}
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="px-6 py-5 text-sm text-neutral-600">
          {credentials ? (
            <div className="space-y-2">
              {credentials.label ? (
                <p>
                  <span className="font-semibold text-brand-dark">
                    Workspace:
                  </span>{" "}
                  {credentials.label}
                </p>
              ) : null}
              <p>
                <span className="font-semibold text-brand-dark">API key:</span>{" "}
                {credentials.hasApiKey ? "Saved" : "Missing"}
              </p>
              <p>
                <span className="font-semibold text-brand-dark">Status:</span>{" "}
                <span
                  className={
                    credentials.isActive
                      ? "text-emerald-700"
                      : "text-neutral-500"
                  }
                >
                  {credentials.isActive ? "Enabled" : "Disabled"}
                </span>
              </p>
            </div>
          ) : (
            <p>No Quo credentials configured yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
