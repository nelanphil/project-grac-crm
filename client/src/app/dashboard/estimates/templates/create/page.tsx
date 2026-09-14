"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink, {
  dashboardBackLinkMutedClass,
} from "@/components/dashboard/DashboardBackLink";
import EstimateTemplateForm from "@/components/estimate/EstimateTemplateForm";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, createEstimateTemplate } from "@/lib/api";

export default function CreateEstimateTemplatePage() {
  return (
    <AuthGuard>
      <CreateEstimateTemplateContent />
    </AuthGuard>
  );
}

function CreateEstimateTemplateContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <DashboardBackLink
        fallbackHref="/dashboard/estimates/templates"
        fallbackLabel="Back to templates"
        className={dashboardBackLinkMutedClass}
      />
      <h1 className="text-2xl font-bold text-brand-dark">New estimate template</h1>
      <p className="text-sm text-neutral-500">
        Add the products that should appear whenever staff start an estimate from
        this template.
      </p>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <EstimateTemplateForm
        submitLabel="Save template"
        submitting={submitting}
        onSubmit={async (data) => {
          if (!token) return;
          setSubmitting(true);
          setError(null);
          try {
            await createEstimateTemplate(token, data);
            router.replace("/dashboard/estimates/templates");
          } catch (err) {
            setError(
              err instanceof ApiError
                ? err.message
                : "Failed to save estimate template.",
            );
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
