"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink, {
  dashboardBackLinkMutedClass,
} from "@/components/dashboard/DashboardBackLink";
import EstimateTemplateForm from "@/components/estimate/EstimateTemplateForm";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  deleteEstimateTemplate,
  EstimateTemplateItem,
  getEstimateTemplate,
  updateEstimateTemplate,
} from "@/lib/api";
import { ticketFromRecord } from "@/lib/service-ticket";

export default function EditEstimateTemplatePage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <EditEstimateTemplateContent />
      </Suspense>
    </AuthGuard>
  );
}

function EditEstimateTemplateContent() {
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";
  const token = useAuthStore((s) => s.token);
  const canWrite = useAuthStore((s) => s.hasPermission("estimates:write"));
  const [template, setTemplate] = useState<EstimateTemplateItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    getEstimateTemplate(token, id)
      .then(({ template: item }) => setTemplate(item))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load estimate template.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, id]);

  const initialParts = useMemo(
    () => ticketFromRecord({ parts: template?.parts }).parts,
    [template],
  );

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading template…</p>;
  }
  if (!template) {
    return (
      <p className="text-sm text-red-700">{error || "Template not found."}</p>
    );
  }

  return (
    <div className="space-y-4">
      <DashboardBackLink
        fallbackHref="/dashboard/estimates/templates"
        fallbackLabel="Back to templates"
        className={dashboardBackLinkMutedClass}
      />
      <h1 className="text-2xl font-bold text-brand-dark">Edit estimate template</h1>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <EstimateTemplateForm
        key={template._id}
        initialName={template.name}
        initialDescPerform={template.descPerform}
        initialLaborHours={template.laborHours}
        initialParts={initialParts}
        submitLabel="Save template"
        submitting={submitting}
        extraActions={
          canWrite ? (
            <button
              type="button"
              onClick={async () => {
                if (!token || !window.confirm("Delete this template?")) return;
                await deleteEstimateTemplate(token, template._id);
                router.push("/dashboard/estimates/templates");
              }}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"
            >
              Delete
            </button>
          ) : null
        }
        onSubmit={async (data) => {
          if (!token) return;
          setSubmitting(true);
          setError(null);
          try {
            const { template: saved } = await updateEstimateTemplate(
              token,
              template._id,
              data,
            );
            setTemplate(saved);
          } catch (err) {
            setError(
              err instanceof ApiError
                ? err.message
                : "Failed to save estimate template.",
            );
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
