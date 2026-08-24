"use client";

import { COMPANY } from "@/lib/constants";
import {
  formatDiscountSummary,
  type TicketContractDiscount,
} from "@/lib/productDiscounts";
import { SERVICE_TICKET_TERMS } from "@/lib/service-ticket";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString();
}

export type ServiceTicketView = {
  variant: "work-order" | "estimate";
  number: string;
  date: string | null;
  tech: string;
  status?: string;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerZip: string;
  customerPhone: string;
  customerEmail: string;
  workPhone: string;
  serialNumber: string;
  generatorModel: string;
  exerciseDay: string;
  exerciseTime: string;
  paid?: boolean;
  runHours?: number;
  laborHours?: number;
  descPerform: string;
  descPerformed?: string;
  parts: Array<{
    quantity: number;
    partNumber: string;
    description?: string;
    unitPrice?: number;
    amount: number;
    lineType?: "product" | "note";
    kind?: "part" | "labor";
  }>;
  totalParts: number;
  totalLabor: number;
  miscExp: number;
  subtotal: number;
  shipping: number;
  total: number;
  signatureDataUrl?: string;
  signedByName?: string;
  contractDiscount?: TicketContractDiscount | null;
};

export default function ServiceTicketDocument({
  ticket,
}: {
  ticket: ServiceTicketView;
}) {
  const isEstimate = ticket.variant === "estimate";
  return (
    <article className="invoice-document rounded-xl border border-neutral-200 bg-white px-4 py-6 shadow-sm sm:px-10 sm:py-10 print:rounded-none print:border-0 print:shadow-none print:px-0 print:py-0">
      <header className="border-b border-neutral-200 pb-5 text-center">
        <p className="text-3xl font-black tracking-[0.2em] text-brand-dark">
          GENERAC
        </p>
        <p className="mt-1 text-lg font-semibold text-brand-dark">{COMPANY.name}</p>
        <p className="text-xs text-neutral-500">
          Authorized Dealer · Certified Technicians · Sales · Service · Installation
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {COMPANY.phone} · {COMPANY.email}
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          {isEstimate ? "Estimate" : "Work Order"} {ticket.number}
        </p>
      </header>

      <div className="mt-5 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p>
          <span className="text-neutral-500">Date:</span> {formatDate(ticket.date)}
        </p>
        <p>
          <span className="text-neutral-500">Tech:</span> {ticket.tech || "—"}
        </p>
        <p>
          <span className="text-neutral-500">Exercise day:</span>{" "}
          {ticket.exerciseDay || "—"}
        </p>
        <p>
          <span className="text-neutral-500">Time set:</span>{" "}
          {ticket.exerciseTime || "—"}
        </p>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="font-semibold text-brand-dark">{ticket.customerName || "—"}</p>
          <p>{ticket.customerAddress}</p>
          <p>
            {ticket.customerCity} {ticket.customerZip}
          </p>
          <p>{ticket.customerPhone}</p>
          <p>{ticket.customerEmail}</p>
          {ticket.workPhone ? <p>Work: {ticket.workPhone}</p> : null}
        </div>
        <div>
          <p>Serial: {ticket.serialNumber || "—"}</p>
          <p>Model: {ticket.generatorModel || "—"}</p>
          {!isEstimate ? (
            <>
              <p>Paid: {ticket.paid ? "Yes" : "No"}</p>
              <p>Run hours: {ticket.runHours ?? "—"}</p>
            </>
          ) : (
            <p className="capitalize">Status: {ticket.status}</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase text-neutral-500">
          Work to be performed
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm">
          {ticket.descPerform || "—"}
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase text-neutral-500">
            Parts & Labor
          </p>
          <table className="mt-1 min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-neutral-500">
                <th className="py-2">Qty</th>
                <th className="py-2">Product</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(ticket.parts.length
                ? ticket.parts
                : [{ quantity: 0, partNumber: "", amount: 0 }]
              ).map((part, index) =>
                part.lineType === "note" ? (
                  <tr key={index} className="border-b border-neutral-100">
                    <td colSpan={3} className="py-2 italic text-neutral-600">
                      {part.description || "—"}
                    </td>
                  </tr>
                ) : (
                  <tr key={index} className="border-b border-neutral-100">
                    <td className="py-2">{part.quantity || ""}</td>
                    <td className="py-2">
                      {part.partNumber}
                      {part.description ? (
                        <span className="ml-2 text-neutral-500">
                          {part.kind === "labor" ? "Labor · " : ""}
                          {part.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      {part.amount ? formatMoney(part.amount) : ""}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 text-sm">
          {!isEstimate ? (
            <div>
              <p className="text-xs font-semibold uppercase text-neutral-500">
                Work performed
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {ticket.descPerformed || "—"}
              </p>
            </div>
          ) : null}
          <div className="space-y-1 border-t border-neutral-200 pt-2">
            {ticket.contractDiscount &&
            formatDiscountSummary(
              ticket.contractDiscount,
              ticket.contractDiscount.label,
            ) ? (
              <p className="text-xs text-sky-800">
                {formatDiscountSummary(
                  ticket.contractDiscount,
                  ticket.contractDiscount.label,
                )}
              </p>
            ) : null}
            <p className="flex justify-between">
              <span>Total parts</span>
              <span>{formatMoney(ticket.totalParts)}</span>
            </p>
            <p className="flex justify-between">
              <span>Total labor</span>
              <span>{formatMoney(ticket.totalLabor)}</span>
            </p>
            <p className="flex justify-between">
              <span>Misc exp.</span>
              <span>{formatMoney(ticket.miscExp)}</span>
            </p>
            <p className="flex justify-between">
              <span>Sub total</span>
              <span>{formatMoney(ticket.subtotal)}</span>
            </p>
            <p className="flex justify-between">
              <span>Shipping</span>
              <span>{formatMoney(ticket.shipping)}</span>
            </p>
            <p className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatMoney(ticket.total)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <p className="text-xs leading-relaxed text-neutral-600">
          {SERVICE_TICKET_TERMS}
        </p>
        <div>
          {ticket.signatureDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ticket.signatureDataUrl}
              alt="Signature"
              className="h-20 w-full max-w-xs object-contain"
            />
          ) : (
            <div className="h-20 border-b border-neutral-300" />
          )}
          <p className="mt-1 text-xs text-neutral-500">
            {ticket.signedByName || "Signature"}
          </p>
        </div>
      </div>
    </article>
  );
}
