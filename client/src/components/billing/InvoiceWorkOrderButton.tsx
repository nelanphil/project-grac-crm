"use client";

import { useState } from "react";
import { ApiError, createInvoice } from "@/lib/api";

const WORK_ORDER_ALREADY_PAID = "Work order is already paid";

export default function InvoiceWorkOrderButton({
  token,
  workOrderRef,
  sourcePaid = false,
  onCreated,
}: {
  token: string;
  workOrderRef: string;
  sourcePaid?: boolean;
  onCreated?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);

  async function createWorkOrderInvoice(allowPaidBypass?: boolean) {
    setBusy(true);
    setError(null);
    try {
      await createInvoice(token, {
        sourceType: "work_order",
        workOrderRef,
        allowPaidBypass,
      });
      setConfirmPaid(false);
      onCreated?.();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.message === WORK_ORDER_ALREADY_PAID
      ) {
        setConfirmPaid(true);
        setBusy(false);
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "Failed to create invoice.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleCreate() {
    if (sourcePaid && !confirmPaid) {
      setConfirmPaid(true);
      setError(null);
      return;
    }
    void createWorkOrderInvoice(sourcePaid ? true : undefined);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={handleCreate}
        className="w-full rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        Invoice work order
      </button>

      {confirmPaid ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p>
            This work order is already paid. Creating another invoice is optional
            and will not collect a second payment automatically.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void createWorkOrderInvoice(true)}
              className="rounded-md bg-brand-dark px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              Create invoice anyway
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmPaid(false)}
              className="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
