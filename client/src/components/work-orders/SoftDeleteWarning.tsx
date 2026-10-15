"use client";

import { AlertTriangle } from "lucide-react";

export default function SoftDeleteWarning({
  deleting = false,
  onConfirm,
  onCancel,
}: {
  deleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm delete work order"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3"
    >
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          This removes the work order from schedules and lists. An owner or
          admin can restore it. Click OK to continue.
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          autoFocus
          disabled={deleting}
          onClick={onConfirm}
          className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {deleting ? "Deleting…" : "OK"}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={onCancel}
          className="inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
