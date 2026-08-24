"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ServiceTicketDocument from "@/components/billing/ServiceTicketDocument";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  convertEstimate,
  deleteEstimate,
  EstimateItem,
  getEstimate,
  updateEstimate,
} from "@/lib/api";
import { ticketFromRecord } from "@/lib/service-ticket";

export default function EstimateDetailPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <EstimateDetailContent />
      </Suspense>
    </AuthGuard>
  );
}

function EstimateDetailContent() {
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";
  const token = useAuthStore((s) => s.token);
  const canWrite = useAuthStore((s) => s.hasPermission("estimates:write"));
  const canDelete = useAuthStore((s) => s.hasPermission("estimates:delete"));
  const [estimate, setEstimate] = useState<EstimateItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    getEstimate(token, id)
      .then(({ estimate: item }) => setEstimate(item))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load estimate."),
      )
      .finally(() => setLoading(false));
  }, [token, id]);

  if (loading) return <p className="text-sm text-neutral-500">Loading estimate…</p>;
  if (!estimate) {
    return (
      <p className="text-sm text-red-700">{error || "Estimate not found."}</p>
    );
  }

  const converted = estimate.status === "converted";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/dashboard/estimates"
          className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-brand-dark"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to estimates
        </Link>
        <div className="flex flex-wrap gap-2">
          {estimate.workOrderRef ? (
            <Link
              href={`/dashboard/work-orders/detail?id=${estimate.workOrderRef}`}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              View work order
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            <Download className="h-4 w-4" />
            Export to PDF
          </button>
          {canWrite && !converted ? (
            <>
              <button
                type="button"
                disabled={converting}
                onClick={async () => {
                  if (!token) return;
                  setConverting(true);
                  setError(null);
                  try {
                    const { workOrder } = await convertEstimate(token, estimate._id);
                    router.push(`/dashboard/work-orders/detail?id=${workOrder._id}`);
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.message
                        : "Failed to convert estimate.",
                    );
                    setConverting(false);
                  }
                }}
                className="rounded-lg bg-brand-orange px-3 py-2 text-sm font-medium text-white"
              >
                {converting ? "Converting…" : "Convert to work order"}
              </button>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white"
              >
                <Pencil className="h-4 w-4" />
                {editing ? "View" : "Edit"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      ) : null}

      {editing && !converted ? (
        <ServiceTicketForm
          variant="estimate"
          initial={ticketFromRecord(estimate)}
          submitting={submitting}
          submitLabel="Save estimate"
          extraActions={
            canDelete ? (
              <button
                type="button"
                onClick={async () => {
                  if (!token || !window.confirm("Delete this estimate?")) return;
                  await deleteEstimate(token, estimate._id);
                  router.push("/dashboard/estimates");
                }}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                Delete
              </button>
            ) : null
          }
          onSubmit={async (payload) => {
            if (!token) return;
            setSubmitting(true);
            setError(null);
            try {
              const { estimate: updated } = await updateEstimate(token, estimate._id, {
                ...payload,
                status: payload.status,
              });
              setEstimate(updated);
              setEditing(false);
            } catch (err) {
              setError(
                err instanceof ApiError ? err.message : "Failed to save estimate.",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : (
        <ServiceTicketDocument
          ticket={{
            variant: "estimate",
            number: estimate.number,
            date: estimate.date,
            tech: estimate.tech,
            status: estimate.status,
            customerName: estimate.customerName,
            customerAddress: estimate.customerAddress,
            customerCity: estimate.customerCity,
            customerZip: estimate.customerZip,
            customerPhone: estimate.customerPhone,
            customerEmail: estimate.customerEmail,
            workPhone: estimate.workPhone,
            serialNumber: estimate.serialNumber,
            generatorModel: estimate.generatorModel,
            exerciseDay: estimate.exerciseDay,
            exerciseTime: estimate.exerciseTime,
            laborHours: estimate.laborHours,
            descPerform: estimate.descPerform,
            parts: estimate.parts,
            totalParts: estimate.totalParts,
            totalLabor: estimate.totalLabor,
            miscExp: estimate.miscExp,
            subtotal: estimate.subtotal,
            shipping: estimate.shipping,
            total: estimate.total,
            signatureDataUrl: estimate.signatureDataUrl,
            signedByName: estimate.signedByName,
            contractDiscount: estimate.contractDiscount,
          }}
        />
      )}
    </div>
  );
}
