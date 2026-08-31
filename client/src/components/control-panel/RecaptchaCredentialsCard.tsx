"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import PasswordInput from "@/components/ui/PasswordInput";
import {
  ApiError,
  deleteRecaptchaCredentials,
  getRecaptchaCredentials,
  RecaptchaCredentialsItem,
  RecaptchaVersion,
  saveRecaptchaCredentials,
} from "@/lib/api";

type FormState = {
  siteKey: string;
  secretKey: string;
  version: RecaptchaVersion;
  minScore: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  siteKey: "",
  secretKey: "",
  version: "v2",
  minScore: "0.5",
  isActive: true,
};

export default function RecaptchaCredentialsCard() {
  const token = useAuthStore((s) => s.token);

  const [credentials, setCredentials] =
    useState<RecaptchaCredentialsItem | null>(null);
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

    getRecaptchaCredentials(token)
      .then(({ credentials: item }) => setCredentials(item))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load reCAPTCHA credentials.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function openEdit() {
    setForm({
      siteKey: credentials?.siteKey ?? "",
      secretKey: "",
      version: credentials?.version ?? "v2",
      minScore: String(credentials?.minScore ?? 0.5),
      isActive: credentials?.isActive ?? true,
    });
    setSaveError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setSaveError(null);
  }

  function field(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (!form.siteKey.trim()) {
      setSaveError("Site key is required.");
      return;
    }
    if (!credentials && !form.secretKey.trim()) {
      setSaveError("Secret key is required.");
      return;
    }

    const minScore = Number(form.minScore);
    if (form.version === "v3" && (Number.isNaN(minScore) || minScore < 0 || minScore > 1)) {
      setSaveError("v3 minimum score must be between 0 and 1.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const { credentials: saved } = await saveRecaptchaCredentials(token, {
        siteKey: form.siteKey.trim(),
        secretKey: form.secretKey.trim() || undefined,
        version: form.version,
        minScore: form.version === "v3" ? minScore : undefined,
        isActive: form.isActive,
      });
      setCredentials(saved);
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save reCAPTCHA credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token) return;
    if (
      !window.confirm(
        "Remove the reCAPTCHA credentials? The contact form will no longer require a challenge.",
      )
    )
      return;

    setDeleting(true);
    try {
      await deleteRecaptchaCredentials(token);
      setCredentials(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete reCAPTCHA credentials.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 shadow-sm">
        Loading reCAPTCHA credentials…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Google reCAPTCHA
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Site key and secret key from the Google reCAPTCHA admin console.
            Used to block bots on the public contact form. v2 shows the
            checkbox; v3 scores submissions in the background.
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
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 border-b border-neutral-100 px-6 py-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {credentials
                ? "Edit reCAPTCHA credentials"
                : "Add reCAPTCHA credentials"}
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
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Site key
              </span>
              <input
                required
                value={form.siteKey}
                onChange={(e) => field("siteKey", e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="6Lc…"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Secret key
                {credentials?.hasSecretKey
                  ? " (leave blank to keep current)"
                  : ""}
              </span>
              <PasswordInput
                required={!credentials}
                value={form.secretKey}
                onChange={(e) => field("secretKey", e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={credentials?.hasSecretKey ? "••••••••" : "6Lc…"}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Version
              </span>
              <select
                value={form.version}
                onChange={(e) =>
                  field("version", e.target.value as RecaptchaVersion)
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              >
                <option value="v2">v2 checkbox</option>
                <option value="v3">v3 score</option>
              </select>
            </label>

            {form.version === "v3" && (
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">
                  Minimum score (0–1)
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={form.minScore}
                  onChange={(e) => field("minScore", e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                />
              </label>
            )}

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
              {saving
                ? "Saving…"
                : credentials
                  ? "Save changes"
                  : "Save credentials"}
            </button>
          </div>
        </form>
      ) : credentials ? (
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="font-medium text-brand-dark">
              reCAPTCHA {credentials.version.toUpperCase()}
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
              Site key {credentials.siteKey ? "set" : "missing"}
              {" · "}
              {credentials.hasSecretKey ? "Secret key set" : "Missing secret key"}
              {credentials.version === "v3"
                ? ` · Min score ${credentials.minScore}`
                : ""}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
              aria-label="Edit reCAPTCHA credentials"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              aria-label="Delete reCAPTCHA credentials"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="px-6 py-8 text-sm text-neutral-500">
          No reCAPTCHA credentials configured yet. Add a site key and secret
          key to protect the contact form.
        </div>
      )}
    </div>
  );
}
