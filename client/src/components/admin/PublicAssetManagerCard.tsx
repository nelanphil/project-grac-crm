"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import {
  API_URL,
  ApiError,
  listPublicAssets,
  PublicAssetItem,
  togglePublicAssetStatus,
  uploadPublicAsset,
} from "@/lib/api";

function randomSlug() {
  const prefix = Array.from(
    { length: 6 },
    () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
  ).join("");
  return `${Date.now().toString(36)}-${prefix}`;
}

export default function PublicAssetManagerCard({
  token,
}: {
  token: string | null;
}) {
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
