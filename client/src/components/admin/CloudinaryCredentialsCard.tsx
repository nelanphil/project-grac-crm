"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
  ApiError,
  CloudinaryCredentialsItem,
  deleteCloudinaryCredentials,
  getCloudinaryCredentials,
  saveCloudinaryCredentials,
} from "@/lib/api";

const EMPTY_CREDENTIALS = {
  cloudName: "",
  apiKey: "",
  apiSecret: "",
  uploadPreset: "",
  isActive: true,
};

export default function CloudinaryCredentialsCard({
  token,
}: {
  token: string | null;
}) {
  const [credentials, setCredentials] =
    useState<CloudinaryCredentialsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState({
    apiKey: false,
    apiSecret: false,
  });
  const [form, setForm] = useState(EMPTY_CREDENTIALS);

  const cloudNameError = useMemo(() => {
    const value = form.cloudName.trim();
    if (!value) return "";
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value)) {
      return "Cloud name must match your Cloudinary account name exactly, using the same letters, numbers, and hyphens from your dashboard.";
    }
    return "";
  }, [form.cloudName]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { credentials: item } = await getCloudinaryCredentials(token!);
        if (!cancelled) setCredentials(item);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load Cloudinary settings.",
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
      cloudName: credentials?.cloudName ?? "",
      apiKey: "",
      apiSecret: "",
      uploadPreset: credentials?.uploadPreset ?? "",
      isActive: credentials?.isActive ?? true,
    });
    setSaveError(null);
    setFormOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (cloudNameError) {
      setSaveError(cloudNameError);
      return;
    }

    if (
      !credentials &&
      (!form.cloudName.trim() || !form.apiKey.trim() || !form.apiSecret.trim())
    ) {
      setSaveError(
        "Cloud name, API key, and API secret are required the first time.",
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const { credentials: saved } = await saveCloudinaryCredentials(token, {
        cloudName: form.cloudName.trim(),
        apiKey: form.apiKey.trim() || undefined,
        apiSecret: form.apiSecret.trim() || undefined,
        uploadPreset: form.uploadPreset.trim() || undefined,
        isActive: form.isActive,
      });
      setCredentials(saved);
      setFormOpen(false);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save Cloudinary credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!token || !credentials) return;
    if (
      !window.confirm(
        "Remove the Cloudinary credentials? Public uploads will no longer work.",
      )
    )
      return;

    setSaving(true);
    try {
      await deleteCloudinaryCredentials(token);
      setCredentials(null);
      setFormOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete Cloudinary settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading Cloudinary settings…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-100 p-2 text-sky-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">
              Cloudinary credentials
            </h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              Used for uploading public images and generating the public-facing
              slug URLs.
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
                Cloud name
              </span>
              <input
                value={form.cloudName}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, cloudName: e.target.value }))
                }
                aria-invalid={Boolean(cloudNameError)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="mycloud"
                required
              />
              <span className="mt-1 block text-xs text-neutral-500">
                This is the Cloud name shown on your Cloudinary dashboard home
                page (e.g. dtxc1dbfx) — not the API key&apos;s &quot;Key
                Name&quot; label.
              </span>
              {cloudNameError && (
                <span className="mt-1 block text-xs text-red-600">
                  {cloudNameError}
                </span>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Upload preset
              </span>
              <input
                value={form.uploadPreset}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, uploadPreset: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Optional preset name"
              />
              <span className="mt-1 block text-xs text-neutral-500">
                Leave blank unless you have a preset saved under Cloudinary
                &rarr; Settings &rarr; Upload &rarr; Upload presets. If set, it
                must match that name exactly or uploads will fail.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                API key
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type={showSecrets.apiKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, apiKey: e.target.value }))
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                  placeholder={
                    credentials
                      ? "leave blank to keep current"
                      : "Cloudinary API key"
                  }
                  required={!credentials}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowSecrets((prev) => ({
                      ...prev,
                      apiKey: !prev.apiKey,
                    }))
                  }
                  className="rounded-md border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
                >
                  {showSecrets.apiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                API secret
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type={showSecrets.apiSecret ? "text" : "password"}
                  value={form.apiSecret}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, apiSecret: e.target.value }))
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                  placeholder={
                    credentials
                      ? "leave blank to keep current"
                      : "Cloudinary API secret"
                  }
                  required={!credentials}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowSecrets((prev) => ({
                      ...prev,
                      apiSecret: !prev.apiSecret,
                    }))
                  }
                  className="rounded-md border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
                >
                  {showSecrets.apiSecret ? (
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
            Enable Cloudinary uploads
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
              <p>
                <span className="font-semibold text-brand-dark">
                  Cloud name:
                </span>{" "}
                {credentials.cloudName}
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
              {credentials.uploadPreset && (
                <p>
                  <span className="font-semibold text-brand-dark">Preset:</span>{" "}
                  {credentials.uploadPreset}
                </p>
              )}
            </div>
          ) : (
            <p>No Cloudinary credentials configured yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
