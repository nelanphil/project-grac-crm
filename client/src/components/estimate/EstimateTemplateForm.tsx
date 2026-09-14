"use client";

import { FormEvent, type ReactNode, useMemo, useState } from "react";
import TicketLineItemsEditor from "@/components/billing/TicketLineItemsEditor";
import {
  TicketPartRow,
  emptyTicketForm,
  ticketToPayload,
  ticketTotals,
  withTrailingEmptyProduct,
} from "@/lib/service-ticket";
import type { WorkOrderPart } from "@/lib/api";

const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

export default function EstimateTemplateForm({
  initialName = "",
  initialDescPerform = "",
  initialLaborHours = 0,
  initialParts = [],
  submitting,
  submitLabel,
  extraActions,
  onSubmit,
}: {
  initialName?: string;
  initialDescPerform?: string;
  initialLaborHours?: number;
  initialParts?: TicketPartRow[];
  submitting?: boolean;
  submitLabel: string;
  extraActions?: ReactNode;
  onSubmit: (data: {
    name: string;
    descPerform: string;
    laborHours: number;
    parts: WorkOrderPart[];
  }) => void | Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [descPerform, setDescPerform] = useState(initialDescPerform);
  const [laborHours, setLaborHours] = useState(
    initialLaborHours ? String(initialLaborHours) : "",
  );
  const [parts, setParts] = useState<TicketPartRow[]>(
    withTrailingEmptyProduct(initialParts),
  );

  const totals = useMemo(
    () =>
      ticketTotals({
        ...emptyTicketForm(),
        laborHours,
        parts,
      }),
    [laborHours, parts],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload = ticketToPayload({
      ...emptyTicketForm(),
      descPerform,
      laborHours,
      parts,
    });
    await onSubmit({
      name: trimmed,
      descPerform: payload.descPerform,
      laborHours: payload.laborHours,
      parts: payload.parts,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs sm:col-span-2">
          <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
            Template name
          </span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Annual service visit"
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
            Labor hours
          </span>
          <input
            value={laborHours}
            onChange={(e) => setLaborHours(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <TicketLineItemsEditor parts={parts} onChange={setParts} />
        <div className="w-full shrink-0 space-y-2 rounded border border-neutral-200 p-3 text-sm lg:w-72">
          <div className="flex justify-between">
            <span>Total parts</span>
            <span>{formatMoney(totals.totalParts)}</span>
          </div>
          <div className="flex justify-between">
            <span>Total labor</span>
            <span>{formatMoney(totals.totalLabor)}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold">
            <span>Template total</span>
            <span>{formatMoney(totals.total)}</span>
          </div>
          <p className="text-xs text-neutral-400">
            These products load onto a new estimate when this template is used.
          </p>
        </div>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
          Description of work to be performed
        </span>
        <textarea
          rows={5}
          value={descPerform}
          onChange={(e) => setDescPerform(e.target.value)}
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4">
        <div>{extraActions}</div>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
