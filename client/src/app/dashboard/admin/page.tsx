"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import PaymentPlatformAppsCard from "@/components/admin/PaymentPlatformAppsCard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getCloudinaryCredentials,
  saveCloudinaryCredentials,
  deleteCloudinaryCredentials,
  listPublicAssets,
  uploadPublicAsset,
  togglePublicAssetStatus,
  API_URL,
  CloudinaryCredentialsItem,
  PublicAssetItem,
} from "@/lib/api";

const EMPTY_CREDENTIALS = {
  cloudName: "",
  apiKey: "",
  apiSecret: "",
  uploadPreset: "",
  isActive: true,
};

function randomSlug() {
  const prefix = Array.from(
    { length: 6 },
    () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
  ).join("");
  return `${Date.now().toString(36)}-${prefix}`;
}

export default function AdminPage() {
  return (
    <AuthGuard>
      <AdminContent />
    </AuthGuard>
  );
}

function AdminContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super-admin";

  useEffect(() => {
    if (user && !isSuperAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isSuperAdmin, router]);

  if (!user || !isSuperAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Admin Panel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage payment platform credentials, public image links, and the
          Cloudinary integration used to upload them.
        </p>
      </div>

      <PaymentPlatformAppsCard token={token} />
      <CloudinaryCredentialsCard token={token} />
      <PublicAssetManagerCard token={token} />
    </div>
  );
}

function CloudinaryCredentialsCard({ token }: { token: string | null }) {
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

function PublicAssetManagerCard({ token }: { token: string | null }) {
  const [assets, setAssets] = useState<PublicAssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [slug, setSlug] = useState(randomSlug());
  const [title, setTitle] = useState("Public image");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive">(
    "active",
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { assets: items } = await listPublicAssets(token!);
        if (!cancelled) setAssets(items);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load public assets.",
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

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedFile) {
      setError("Choose a file before uploading.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const saved = await uploadPublicAsset(token, {
        file: selectedFile,
        slug: slug.trim() || randomSlug(),
        title: title.trim() || "Public image",
      });
      setAssets((prev) => [saved.asset, ...prev]);
      setStatusFilter("active");
      setSelectedFile(null);
      setSlug(randomSlug());
      setTitle("Public image");
      const input = document.getElementById(
        "public-asset-file",
      ) as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    if (!token) return;
    try {
      const { asset } = await togglePublicAssetStatus(token, id, isActive);
      setAssets((prev) => prev.map((item) => (item._id === id ? asset : item)));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Unable to update the asset status.",
      );
    }
  }

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) =>
        statusFilter === "active" ? asset.isActive : !asset.isActive,
      ),
    [assets, statusFilter],
  );

  const publicBaseUrl = `${API_URL.replace(/\/$/, "")}/public-assets`;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Public image links
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Upload an image and generate a random public slug. Deactivate or
            restore it any time.
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleUpload}
        className="space-y-4 border-b border-neutral-100 px-6 py-5"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Image file
            </span>
            <input
              id="public-asset-file"
              type="file"
              accept="image/*"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setSelectedFile(e.target.files?.[0] ?? null)
              }
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-dark file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Public slug
            </span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="random-slug"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-neutral-600">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="Public image title"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSlug(randomSlug())}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className="h-4 w-4" />
            Random slug
          </button>
          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="inline-flex items-center gap-2 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Upload image"}
          </button>
        </div>
      </form>

      <div className="px-6 py-5">
        {loading ? (
          <div className="text-sm text-neutral-500">Loading public assets…</div>
        ) : assets.length === 0 ? (
          <div className="text-sm text-neutral-500">
            No public image links have been created yet.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  statusFilter === "active"
                    ? "bg-brand-dark text-white"
                    : "text-neutral-600 hover:text-brand-dark"
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("inactive")}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  statusFilter === "inactive"
                    ? "bg-brand-dark text-white"
                    : "text-neutral-600 hover:text-brand-dark"
                }`}
              >
                Inactive
              </button>
            </div>
            {filteredAssets.length === 0 ? (
              <div className="text-sm text-neutral-500">
                {statusFilter === "active"
                  ? "No active public image links."
                  : "No inactive public image links."}
              </div>
            ) : (
              filteredAssets.map((asset) => (
                <div
                  key={asset._id}
                  className="rounded-lg border border-neutral-200 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-brand-dark">
                        {asset.title}
                      </p>
                    <a
                      href={`${publicBaseUrl}/${asset.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 break-all text-xs text-neutral-500 hover:text-brand-dark hover:underline"
                    >
                      {publicBaseUrl}/{asset.slug}
                    </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${asset.isActive ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-700"}`}
                      >
                        {asset.isActive ? "Active" : "Inactive"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggle(asset._id, !asset.isActive)}
                        className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        {asset.isActive ? "Deactivate" : "Restore"}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
