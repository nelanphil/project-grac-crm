"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, createEstimate, getCustomer } from "@/lib/api";
import { emptyTicketForm, TicketFormState } from "@/lib/service-ticket";

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
  const customerId = useSearchParams().get("customerId");
  const [initial, setInitial] = useState<TicketFormState>(emptyTicketForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !customerId) return;
    getCustomer(token, customerId)
      .then(({ customer }) => {
        const form = emptyTicketForm();
        const site = customer.addresses.find((a) => a.isPrimary) ?? customer.addresses[0];
        const equipment = site?.equipment?.[0];
        setInitial({
          ...form,
          customerRef: customer._id,
          customerId: customer.legacyId,
          customerName: customer.accountName || `${customer.first} ${customer.last}`.trim(),
          customerAddress: site?.address ?? customer.address,
          customerCity: site?.city ?? customer.city,
          customerZip: site?.zip ?? customer.zip,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          addressRef: site?._id ?? "",
          equipmentRef: equipment?._id ?? "",
          serialNumber: equipment?.serial ?? customer.serial,
          generatorModel: equipment?.generatorModel ?? customer.generatorModel,
          exerciseDay: equipment?.exday ?? customer.exday,
          exerciseTime: equipment?.extime ?? customer.extime,
        });
      })
      .catch(() => undefined);
  }, [token, customerId]);

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/estimates"
        className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-brand-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to estimates
      </Link>
      <h1 className="text-2xl font-bold text-brand-dark">New estimate</h1>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
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
            router.push(`/dashboard/estimates/detail?id=${estimate._id}`);
          } catch (err) {
            setError(
              err instanceof ApiError ? err.message : "Failed to create estimate.",
            );
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
