"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  createWorkOrder,
  getCustomer,
  getEstimate,
} from "@/lib/api";
import {
  emptyTicketForm,
  ticketFromRecord,
  TicketFormState,
} from "@/lib/service-ticket";

export default function CreateWorkOrderPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <CreateWorkOrderContent />
      </Suspense>
    </AuthGuard>
  );
}

function CreateWorkOrderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const customerId = searchParams.get("customerId");
  const estimateId = searchParams.get("estimateId");
  const [initial, setInitial] = useState<TicketFormState>(emptyTicketForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (estimateId) {
      getEstimate(token, estimateId)
        .then(({ estimate }) =>
          setInitial(
            ticketFromRecord({
              ...estimate,
              number: "",
              paid: false,
              completed: false,
              descPerformed: "",
              signatureDataUrl: "",
              signedByName: "",
            }),
          ),
        )
        .catch(() => undefined);
      return;
    }
    if (customerId) {
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
    }
  }, [token, customerId, estimateId]);

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/work-orders"
        className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-brand-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to work orders
      </Link>
      <h1 className="text-2xl font-bold text-brand-dark">New work order</h1>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <ServiceTicketForm
        variant="work-order"
        initial={initial}
        submitting={submitting}
        submitLabel="Add work order"
        onSubmit={async (payload) => {
          if (!token) return;
          setSubmitting(true);
          setError(null);
          try {
            const created = await createWorkOrder(token, {
              ...payload,
              estimateRef: estimateId,
            });
            router.push(`/dashboard/work-orders/detail?id=${created._id}`);
          } catch (err) {
            setError(
              err instanceof ApiError ? err.message : "Failed to create work order.",
            );
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
