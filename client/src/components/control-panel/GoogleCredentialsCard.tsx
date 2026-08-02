"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import PasswordInput from "@/components/ui/PasswordInput";
import {
  ApiError,
  deleteGoogleCredentials,
  getGoogleCredentials,
  GoogleCredentialsItem,
  saveGoogleCredentials,
} from "@/lib/api";

type FormState = {
  label: string;
  apiKey: string;
  mapsBrowserApiKey: string;
  clearMapsBrowserApiKey: boolean;
  projectId: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  label: "Google Address Validation API",
  apiKey: "",
  mapsBrowserApiKey: "",
  clearMapsBrowserApiKey: false,
  projectId: "",
  isActive: true,
};

export default function GoogleCredentialsCard() {
  const token = useAuthStore((s) => s.token);

  const [credentials, setCredentials] = useState<GoogleCredentialsItem | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    getGoogleCredentials(token)
      .then(({ credentials: item }) => setCredentials(item))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load Google credentials.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function openEdit() {
    setForm({
      label: credentials?.label || "Google Address Validation API",
      apiKey: "",
      mapsBrowserApiKey: "",
      clearMapsBrowserApiKey: false,
      projectId: credentials?.projectId || "",
      isActive: credentials?.isActive ?? true,
    });
    setSaveError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setSaveError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (!credentials && !form.apiKey.trim()) {
      setSaveError("API key is required.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const { credentials: saved } = await saveGoogleCredentials(token, {
        label: form.label.trim() || undefined,
        apiKey: form.apiKey.trim() || undefined,
        mapsBrowserApiKey: form.mapsBrowserApiKey.trim() || undefined,
        clearMapsBrowserApiKey: form.clearMapsBrowserApiKey || undefined,
        projectId: form.projectId.trim(),
        isActive: form.isActive,
      });
      setCredentials(saved);
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save Google credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token) return;
    if (
      !window.confirm(
        "Remove the Google credentials? This cannot be undone.",
      )
    )
      return;

    setDeleting(true);
    try {
      await deleteGoogleCredentials(token);
      setCredentials(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete Google credentials.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function field(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading Google credentials…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Google credentials
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Server key for Address Validation, plus an optional Maps JavaScript
            API key (HTTP-referrer restricted) for the Territory map. Do not
            reuse the Address Validation key in the browser.
          </p>
        </div>
        {!formOpen && !credentials && (
          <button
            type="button"
            onClick={openEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            Add credentials
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="border-b border-neutral-100 px-6 py-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {credentials ? "Edit Google credentials" : "Add Google credentials"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Label
              </span>
              <input
                value={form.label}
                onChange={(e) => field("label", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Google Address Validation API"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Address Validation API key
                {credentials ? " (leave blank to keep current)" : ""}
              </span>
              <PasswordInput
                required={!credentials}
                value={form.apiKey}
                onChange={(e) => field("apiKey", e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={credentials ? "••••••••" : "AIza…"}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Maps JavaScript API key (browser)
                {credentials?.hasMapsBrowserApiKey
                  ? " (leave blank to keep current)"
                  : ""}
              </span>
              <PasswordInput
                value={form.mapsBrowserApiKey}
                onChange={(e) => {
                  field("mapsBrowserApiKey", e.target.value);
                  if (e.target.value) field("clearMapsBrowserApiKey", false);
                }}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={
                  credentials?.hasMapsBrowserApiKey ? "••••••••" : "AIza…"
                }
              />
              <span className="mt-1 block text-xs text-neutral-400">
                Enable Maps JavaScript API in GCP. Restrict by HTTP referrer
                (e.g. localhost and your production origin).
              </span>
            </label>

            {credentials?.hasMapsBrowserApiKey ? (
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.clearMapsBrowserApiKey}
                  onChange={(e) =>
                    field("clearMapsBrowserApiKey", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
                />
                <span className="text-sm text-neutral-700">
                  Clear Maps JavaScript API key
                </span>
              </label>
            ) : null}

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Google Cloud project ID (optional)
              </span>
              <input
                value={form.projectId}
                onChange={(e) => field("projectId", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="my-gcp-project"
              />
            </label>

            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => field("isActive", e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
              />
              <span className="text-sm text-neutral-700">Active</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : credentials ? "Save changes" : "Save credentials"}
            </button>
          </div>
        </form>
      ) : credentials ? (
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="font-medium text-brand-dark">
              {credentials.label}
              <span
                className={
                  credentials.isActive
                    ? "ml-2 inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                    : "ml-2 inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
                }
              >
                {credentials.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-neutral-400">
              {credentials.hasApiKey
                ? "Address Validation key set"
                : "Missing Address Validation key"}
              {" · "}
              {credentials.hasMapsBrowserApiKey
                ? "Maps JS key set"
                : "No Maps JS key"}
              {credentials.projectId
                ? ` · Project: ${credentials.projectId}`
                : ""}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
              aria-label="Edit Google credentials"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              aria-label="Delete Google credentials"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="px-6 py-8 text-sm text-neutral-500">
          No Google credentials configured yet. Add an API key to enable the
          Address Validation API.
        </div>
      )}
    </div>
  );
}
