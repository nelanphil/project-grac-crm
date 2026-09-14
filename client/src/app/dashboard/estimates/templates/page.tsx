"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy, Plus, Star } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink, {
  dashboardBackLinkMutedClass,
} from "@/components/dashboard/DashboardBackLink";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  deleteEstimateTemplate,
  EstimateTemplateItem,
  getEstimateTemplates,
  setEstimateTemplateDefault,
} from "@/lib/api";

function formatMoneyFromTemplate(template: EstimateTemplateItem): string {
  const total = (template.parts ?? []).reduce(
    (sum, part) => sum + (part.amount || 0),
    0,
  );
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(total);
}

export default function EstimateTemplatesPage() {
  return (
    <AuthGuard>
      <EstimateTemplatesContent />
    </AuthGuard>
  );
}

function EstimateTemplatesContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const canWrite = useAuthStore((s) => s.hasPermission("estimates:write"));
  const canSetDefault = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );
  const [templates, setTemplates] = useState<EstimateTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getEstimateTemplates(token)
      .then(({ templates: list }) => setTemplates(list))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load estimate templates.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleDefault(template: EstimateTemplateItem) {
    if (!token) return;
    setBusyId(template._id);
    setError(null);
    try {
      const { template: updated } = await setEstimateTemplateDefault(
        token,
        template._id,
        !template.isDefault,
      );
      setTemplates((prev) =>
        prev
          .map((item) =>
            item._id === updated._id
              ? updated
              : { ...item, isDefault: false },
          )
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to update the default template.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(template: EstimateTemplateItem) {
    if (!token || !window.confirm(`Delete template “${template.name}”?`)) return;
    setBusyId(template._id);
    setError(null);
    try {
      await deleteEstimateTemplate(token, template._id);
      setTemplates((prev) => prev.filter((item) => item._id !== template._id));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete estimate template.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardBackLink
        fallbackHref="/dashboard/estimates"
        fallbackLabel="Back to estimates"
        className={dashboardBackLinkMutedClass}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">
            Estimate templates
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Save a product list that staff can preload onto a new estimate.
            Admins can mark one template as the default for every new estimate.
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/dashboard/estimates/templates/create"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New template
          </Link>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
          <Copy className="mb-4 h-10 w-10 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-500">
            No estimate templates yet
          </p>
          {canWrite ? (
            <Link
              href="/dashboard/estimates/templates/create"
              className="mt-4 text-sm font-medium text-brand-orange hover:underline"
            >
              Create the first template
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-neutral-100 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Template
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Products
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Total
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {templates.map((template) => (
                <tr key={template._id} className="hover:bg-neutral-50">
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      className="text-left font-medium text-brand-dark hover:underline"
                      onClick={() =>
                        router.push(
                          `/dashboard/estimates/templates/edit?id=${template._id}`,
                        )
                      }
                    >
                      {template.name}
                    </button>
                    {template.isDefault ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        <Star className="h-3 w-3 fill-current" />
                        Default
                      </span>
                    ) : null}
                    {template.descPerform ? (
                      <p className="mt-1 max-w-md truncate text-xs text-neutral-400">
                        {template.descPerform}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 text-neutral-600">
                    {template.productCount}
                  </td>
                  <td className="px-6 py-4 text-neutral-600">
                    {formatMoneyFromTemplate(template)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Link
                        href={`/dashboard/estimates/create?templateId=${template._id}`}
                        className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        Use
                      </Link>
                      {canSetDefault ? (
                        <button
                          type="button"
                          disabled={busyId === template._id}
                          onClick={() => handleDefault(template)}
                          className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {template.isDefault ? "Clear default" : "Set default"}
                        </button>
                      ) : null}
                      {canWrite ? (
                        <>
                          <Link
                            href={`/dashboard/estimates/templates/edit?id=${template._id}`}
                            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            disabled={busyId === template._id}
                            onClick={() => handleDelete(template)}
                            className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
