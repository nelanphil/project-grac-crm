"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink, {
  dashboardBackLinkMutedClass,
} from "@/components/dashboard/DashboardBackLink";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  createEstimate,
  EstimateTemplateItem,
  getCustomer,
  getEstimateTemplates,
} from "@/lib/api";
import {
  applyEstimateTemplate,
  emptyTicketForm,
  TicketFormState,
} from "@/lib/service-ticket";

export default function CreateEstimatePage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <CreateEstimateContent />
      </Suspense>
    </AuthGuard>
  );
}

function CreateEstimateContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customerId");
  const requestedTemplateId = searchParams.get("templateId");
  const [customerPatch, setCustomerPatch] = useState<Partial<TicketFormState>>(
    {},
  );
  const [templates, setTemplates] = useState<EstimateTemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templatesReady, setTemplatesReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getEstimateTemplates(token)
      .then(({ templates: list }) => {
        setTemplates(list);
        const requested = requestedTemplateId
          ? list.find((item) => item._id === requestedTemplateId)
          : undefined;
        const fallback = list.find((item) => item.isDefault);
        setSelectedTemplateId(requested?._id ?? fallback?._id ?? "");
      })
      .catch(() => {
        setTemplates([]);
        setSelectedTemplateId("");
      })
      .finally(() => setTemplatesReady(true));
  }, [token, requestedTemplateId]);

  useEffect(() => {
    if (!token || !customerId) return;
    getCustomer(token, customerId)
      .then(({ customer }) => {
        const site =
          customer.addresses.find((a) => a.isPrimary) ?? customer.addresses[0];
        const equipment = site?.equipment?.[0];
        setCustomerPatch({
          customerRef: customer._id,
          customerId: customer.legacyId,
          customerName:
            customer.accountName ||
            `${customer.first} ${customer.last}`.trim(),
          customerAddress: site?.address ?? customer.address,
          customerCity: site?.city ?? customer.city,
          customerZip: site?.zip ?? customer.zip,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          addressRef: site?._id ?? "",
          equipmentRef: equipment?._id ?? "",
          serialNumber: equipment?.serial ?? customer.serial,
          generatorModel:
            equipment?.generatorModel ?? customer.generatorModel,
          exerciseDay: equipment?.exday ?? customer.exday,
          exerciseTime: equipment?.extime ?? customer.extime,
        });
      })
      .catch(() => undefined);
  }, [token, customerId]);

  const selectedTemplate =
    templates.find((item) => item._id === selectedTemplateId) ?? null;

  const initial = useMemo(() => {
    const form = {
      ...emptyTicketForm(),
      ...customerPatch,
    };
    return applyEstimateTemplate(form, selectedTemplate);
  }, [customerPatch, selectedTemplate]);

  return (
    <div className="space-y-4">
      <DashboardBackLink
        fallbackHref={
          customerId
            ? `/dashboard/customers/detail?id=${customerId}`
            : "/dashboard/estimates"
        }
        className={dashboardBackLinkMutedClass}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">New estimate</h1>
        {templatesReady && templates.length > 0 ? (
          <label className="block text-xs sm:min-w-[16rem]">
            <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
              Estimate template
            </span>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            >
              <option value="">Blank estimate</option>
              {templates.map((template) => (
                <option key={template._id} value={template._id}>
                  {template.name}
                  {template.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {selectedTemplate ? (
        <p className="text-sm text-neutral-500">
          Loaded {selectedTemplate.productCount} product
          {selectedTemplate.productCount === 1 ? "" : "s"} from “
          {selectedTemplate.name}”. Switching templates replaces the line items.
        </p>
      ) : templatesReady && templates.length > 0 ? (
        <p className="text-sm text-neutral-500">
          Starting from a blank estimate. Choose a template to preload products.
        </p>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {!templatesReady ? (
        <p className="text-sm text-neutral-500">Loading estimate…</p>
      ) : (
      <ServiceTicketForm
        variant="estimate"
        initial={initial}
        submitting={submitting}
        submitLabel="Save estimate"
        onSubmit={async (payload) => {
          if (!token) return;
          setSubmitting(true);
          setError(null);
          try {
            const { estimate } = await createEstimate(token, {
              ...payload,
              status: payload.status,
            });
            router.replace(`/dashboard/estimates/detail?id=${estimate._id}`);
          } catch (err) {
            setError(
              err instanceof ApiError ? err.message : "Failed to create estimate.",
            );
            setSubmitting(false);
          }
        }}
      />
      )}
    </div>
  );
}
