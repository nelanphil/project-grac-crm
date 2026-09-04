"use client";

import { RefObject, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  Loader2,
  MessageSquare,
  Square,
} from "lucide-react";
import {
  MergeFieldItem,
  MessageTemplateItem,
  MessagingContactItem,
  MessagingSendResponse,
  ThreadConflictCheck,
  TwilioAccountItem,
  checkMessagingThreadConflict,
} from "@/lib/api";
import {
  formatCustomerName,
  formatCustomerRecordName,
  toProperCase,
} from "@/lib/formatName";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { formatTime } from "./MessageBubble";
import PhonePreview from "./PhonePreview";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const STEPS = [
  { key: "recipients", label: "Recipients" },
  { key: "message", label: "Message" },
  { key: "account", label: "Account" },
  { key: "review", label: "Review & send" },
] as const;

function formatPhone(phone: string | undefined | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatRenewalDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

type CreatePanelProps = {
  token: string;

  search: string;
  onSearchChange: (value: string) => void;
  useRenewalsFilter: boolean;
  onToggleRenewalsFilter: (value: boolean) => void;
  viewYear: number;
  viewMonth: number;
  onShiftMonth: (delta: number) => void;

  contacts: MessagingContactItem[];
  contactsTotal: number;
  loadingContacts: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;

  selectedIds: Set<string>;
  selectedContacts: MessagingContactItem[];
  onToggleContact: (contact: MessagingContactItem) => void;
  onToggleSelectPage: () => void;
  onClearSelection: () => void;
  showSelectAllPrompt: boolean;
  selectingAll: boolean;
  onSelectAll: () => void;
  maxSend: number;

  templates: MessageTemplateItem[];
  selectedTemplateId: string | null;
  onSelectTemplate: (template: MessageTemplateItem) => void;
  onStartNewTemplate: () => void;

  mergeFields: MergeFieldItem[];
  onInsertMergeField: (key: string) => void;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  body: string;
  onBodyChange: (value: string) => void;

  mediaUrlsRaw: string;
  onMediaUrlsRawChange: (value: string) => void;

  accounts: TwilioAccountItem[];
  accountId: string;
  onAccountIdChange: (value: string) => void;
  fromOptions: string[];
  effectiveFromNumber: string;
  onFromNumberChange: (value: string) => void;

  sending: boolean;
  confirmOpen: boolean;
  onOpenConfirm: () => void;
  onCloseConfirm: () => void;
  onConfirmSend: () => void;
  onCancelFlow: () => void;

  previewText: string;
  previewContactLabel?: string;
  previewSample: boolean;

  error: string | null;
  sendResult: MessagingSendResponse | null;
  onDismissSendResult: () => void;
};

export default function CreatePanel({
  token,
  search,
  onSearchChange,
  useRenewalsFilter,
  onToggleRenewalsFilter,
  viewYear,
  viewMonth,
  onShiftMonth,
  contacts,
  contactsTotal,
  loadingContacts,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  selectedIds,
  selectedContacts,
  onToggleContact,
  onToggleSelectPage,
  onClearSelection,
  showSelectAllPrompt,
  selectingAll,
  onSelectAll,
  maxSend,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onStartNewTemplate,
  mergeFields,
  onInsertMergeField,
  bodyRef,
  body,
  onBodyChange,
  mediaUrlsRaw,
  onMediaUrlsRawChange,
  accounts,
  accountId,
  onAccountIdChange,
  fromOptions,
  effectiveFromNumber,
  onFromNumberChange,
  sending,
  confirmOpen,
  onOpenConfirm,
  onCloseConfirm,
  onConfirmSend,
  onCancelFlow,
  previewText,
  previewContactLabel,
  previewSample,
  error,
  sendResult,
  onDismissSendResult,
}: CreatePanelProps) {
  const [conflict, setConflict] = useState<ThreadConflictCheck | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [maxStepIndex, setMaxStepIndex] = useState(0);

  const totalPages = Math.max(1, Math.ceil(contactsTotal / pageSize));
  const pageAllSelected =
    contacts.length > 0 && contacts.every((c) => selectedIds.has(c._id));

  // Open-thread conflict check when exactly one recipient is selected
  useEffect(() => {
    if (selectedIds.size !== 1 || !effectiveFromNumber) {
      queueMicrotask(() => setConflict(null));
      return;
    }
    const contactId = [...selectedIds][0];
    let cancelled = false;
    const timer = setTimeout(() => {
      checkMessagingThreadConflict(token, {
        contactId,
        fromNumber: effectiveFromNumber,
      })
        .then((res) => {
          if (!cancelled) setConflict(res);
        })
        .catch(() => {
          if (!cancelled) setConflict(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, selectedIds, effectiveFromNumber]);

  const step = STEPS[stepIndex].key;

  const nextDisabled =
    (step === "recipients" && selectedIds.size === 0) ||
    (step === "message" && !body.trim()) ||
    (step === "account" && (!accountId || !effectiveFromNumber));

  function goToStep(i: number) {
    if (i <= maxStepIndex) setStepIndex(i);
  }

  function goNext() {
    const next = Math.min(stepIndex + 1, STEPS.length - 1);
    setStepIndex(next);
    setMaxStepIndex((m) => Math.max(m, next));
  }

  function goBack() {
    setStepIndex((s) => Math.max(0, s - 1));
  }

  const selectedAccount = accounts.find((a) => a._id === accountId);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-brand-dark">Message Wizard</h2>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {sendResult ? (
        <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm">
          <p className="font-medium text-brand-dark">
            Send complete — {sendResult.summary.sent} sent,{" "}
            {sendResult.summary.failed} failed
          </p>
          {sendResult.summary.failed > 0 ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-neutral-600">
              {sendResult.results
                .filter((r) => r.status === "failed")
                .map((r) => (
                  <li key={r.contactId}>
                    {r.contactId}: {r.error || "Failed"}
                  </li>
                ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs font-medium text-brand-orange hover:underline"
            onClick={onDismissSendResult}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Step indicator */}
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => {
          const active = i === stepIndex;
          const done = i < maxStepIndex;
          const reachable = i <= maxStepIndex;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!reachable}
              onClick={() => goToStep(i)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 ${
                active
                  ? "bg-brand-dark text-white"
                  : reachable
                    ? "border border-neutral-200 bg-white text-neutral-600 hover:border-brand-orange hover:text-brand-orange"
                    : "border border-neutral-100 bg-neutral-50 text-neutral-300"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  active
                    ? "bg-white text-brand-dark"
                    : done
                      ? "bg-brand-orange text-white"
                      : "bg-neutral-200 text-neutral-500"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      {step === "recipients" ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-brand-dark">
              Recipients
            </h2>
            <span className="text-xs text-neutral-500">
              {selectedIds.size} selected
              {selectedIds.size > 0 ? ` · max ${maxSend}` : ""}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search contacts by name or phone…"
              className="min-w-[220px] flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={useRenewalsFilter}
                onChange={(e) => onToggleRenewalsFilter(e.target.checked)}
              />
              Upcoming renewals
            </label>
          </div>

          {useRenewalsFilter ? (
            <div className="mb-3 flex justify-center">
              <div className="inline-flex items-center gap-3 rounded-lg bg-neutral-50 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => onShiftMonth(-1)}
                  className="rounded p-1 text-neutral-500 hover:bg-white hover:text-brand-dark"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[10rem] text-center text-sm font-medium text-brand-dark">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  onClick={() => onShiftMonth(1)}
                  className="rounded p-1 text-neutral-500 hover:bg-white hover:text-brand-dark"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleSelectPage}
              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-brand-dark"
            >
              {pageAllSelected ? (
                <CheckSquare className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              Select page
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-neutral-500 hover:text-brand-dark"
            >
              Clear
            </button>
            {showSelectAllPrompt ? (
              <button
                type="button"
                onClick={onSelectAll}
                disabled={selectingAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-orange hover:text-brand-dark disabled:opacity-60"
              >
                {selectingAll ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Select all {Math.min(contactsTotal, maxSend)} matching contacts?
              </button>
            ) : null}
          </div>

          <div className="max-h-[320px] overflow-auto rounded-lg border border-neutral-100 md:max-h-[440px]">
            {loadingContacts ? (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading contacts…
              </div>
            ) : contacts.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-neutral-500">
                No contacts with valid phone numbers found.
              </div>
            ) : (
              <ResponsiveDataView
                className="p-2 md:p-0"
                mobile={contacts.map((c) => {
                  const checked = selectedIds.has(c._id);
                  const labelBits = [
                    c.label ? toProperCase(c.label) : null,
                    c.isPrimary ? "Primary" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <MobileDataCard
                      key={c._id}
                      title={
                        <span className="inline-flex items-center gap-2">
                          {checked ? (
                            <CheckSquare className="h-4 w-4 shrink-0 text-brand-orange" />
                          ) : (
                            <Square className="h-4 w-4 shrink-0 text-neutral-300" />
                          )}
                          {formatCustomerName(c.first, c.last) || "—"}
                        </span>
                      }
                      subtitle={labelBits || undefined}
                      className={
                        checked
                          ? "border-brand-orange/40 bg-orange-50/40"
                          : ""
                      }
                      fields={
                        <>
                          <DataField
                            label="Phone"
                            value={formatPhone(c.phone)}
                          />
                          <DataField
                            label="Customer"
                            value={
                              formatCustomerRecordName(c.customer) || "—"
                            }
                          />
                          {useRenewalsFilter ? (
                            <DataField
                              label="Renewal"
                              value={formatRenewalDate(c.renewalDueDate)}
                              className="col-span-2"
                            />
                          ) : null}
                        </>
                      }
                      onClick={() => onToggleContact(c)}
                    />
                  );
                })}
                desktop={
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
                      <tr>
                        <th className="w-8 px-2 py-2" />
                        <th className="px-2 py-2 font-medium">Contact</th>
                        <th className="px-2 py-2 font-medium">Phone</th>
                        <th className="px-2 py-2 font-medium">Customer</th>
                        {useRenewalsFilter ? (
                          <th className="px-2 py-2 font-medium">Renewal</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => {
                        const checked = selectedIds.has(c._id);
                        return (
                          <tr
                            key={c._id}
                            className={`border-t border-neutral-100 ${
                              checked
                                ? "bg-orange-50/50"
                                : "hover:bg-neutral-50"
                            }`}
                          >
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggleContact(c)}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <div className="font-medium text-brand-dark">
                                {formatCustomerName(c.first, c.last) || "—"}
                              </div>
                              {c.label ? (
                                <div className="text-[11px] text-neutral-400">
                                  {toProperCase(c.label)}
                                  {c.isPrimary ? " · Primary" : ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-neutral-700">
                              {formatPhone(c.phone)}
                            </td>
                            <td className="px-2 py-2 text-neutral-600">
                              {formatCustomerRecordName(c.customer) || "—"}
                            </td>
                            {useRenewalsFilter ? (
                              <td className="px-2 py-2 whitespace-nowrap text-neutral-600">
                                {formatRenewalDate(c.renewalDueDate)}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                }
              />
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {contactsTotal} contact{contactsTotal === 1 ? "" : "s"}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                Show
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="rounded border border-neutral-200 px-1.5 py-1"
                >
                  <option value={50}>50</option>
                  <option value={150}>150</option>
                  <option value={200}>200</option>
                </select>
                per page
              </label>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
                className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "message" ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Template
            </span>
            <select
              value={selectedTemplateId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  onStartNewTemplate();
                  return;
                }
                const t = templates.find((tpl) => tpl._id === id);
                if (t) onSelectTemplate(t);
              }}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            >
              <option value="">Custom message (no template)</option>
              {templates.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {mergeFields.map((field) => (
              <button
                key={field.key}
                type="button"
                title={field.description}
                onClick={() => onInsertMergeField(field.key)}
                className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-brand-orange hover:text-brand-orange"
              >
                {`{{${field.key}}}`}
              </button>
            ))}
          </div>

          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            rows={6}
            maxLength={1600}
            className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            placeholder="Write your SMS message…"
          />
          <p className="mt-1 text-right text-[11px] text-neutral-400">
            {body.length}/1600
          </p>

          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              MMS media URLs (optional, one per line — publicly reachable)
            </span>
            <textarea
              value={mediaUrlsRaw}
              onChange={(e) => onMediaUrlsRawChange(e.target.value)}
              rows={2}
              placeholder="https://example.com/image.jpg"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            />
          </label>
        </div>
      ) : null}

      {step === "account" ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-brand-dark">
            Twilio account &amp; number
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[180px] flex-1 text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-500">
                Twilio account
              </span>
              <select
                value={accountId}
                onChange={(e) => onAccountIdChange(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              >
                {accounts.length === 0 ? (
                  <option value="">No active accounts</option>
                ) : (
                  accounts.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.friendlyName} ({a.accountSid.slice(0, 6)}…)
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="min-w-[160px] flex-1 text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-500">
                From number
              </span>
              <select
                value={effectiveFromNumber}
                onChange={(e) => onFromNumberChange(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              >
                {fromOptions.length === 0 ? (
                  <option value="">No numbers</option>
                ) : (
                  fromOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
          {accounts.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              Configure an active Twilio account with phone numbers in Control
              Panel before sending.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "review" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-brand-dark">
              Review
            </h2>

            {conflict?.hasOpenThread && conflict.openThread ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This contact already has an open thread on{" "}
                  {conflict.openThread.ourNumber} (last message{" "}
                  {formatTime(conflict.openThread.lastMessageAt) || "—"}) —
                  sending will continue that thread instead of starting a new
                  one.
                </span>
              </div>
            ) : null}

            <dl className="mb-4 space-y-2 text-sm">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                <dt className="text-neutral-500">Recipients</dt>
                <dd className="font-medium text-brand-dark">
                  {selectedIds.size} selected
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                <dt className="text-neutral-500">Twilio account</dt>
                <dd className="font-medium text-brand-dark">
                  {selectedAccount?.friendlyName || "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                <dt className="text-neutral-500">From number</dt>
                <dd className="font-medium text-brand-dark">
                  {effectiveFromNumber || "—"}
                </dd>
              </div>
              {mediaUrlsRaw.trim() ? (
                <div className="flex items-center justify-between pb-2">
                  <dt className="text-neutral-500">Media</dt>
                  <dd className="font-medium text-brand-dark">MMS attached</dd>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={
                  sending ||
                  selectedIds.size === 0 ||
                  !accountId ||
                  !effectiveFromNumber ||
                  !body.trim()
                }
                onClick={onOpenConfirm}
                className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <MessageSquare className="h-4 w-4" />
                Send to {selectedIds.size}
                {mediaUrlsRaw.trim() ? " (MMS)" : ""}
              </button>
              <button
                type="button"
                onClick={onCancelFlow}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>

          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-brand-dark">
              Phone preview
            </h2>
            <p className="mb-4 text-xs text-neutral-500">
              {selectedIds.size === 1
                ? "Preview uses the selected contact’s data."
                : "Select a single contact for a live merge preview, or view sample data."}
            </p>
            <PhonePreview
              message={previewText}
              contactLabel={previewContactLabel}
              isSample={previewSample}
            />
          </section>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-brand-dark">
              Recipients ({selectedIds.size})
            </h2>
            {selectedContacts.length === 0 ? (
              <p className="text-sm text-neutral-500">No recipients selected.</p>
            ) : (
              <div className="max-h-[320px] overflow-auto rounded-lg border border-neutral-100">
                <ResponsiveDataView
                  className="p-2 md:p-0"
                  mobile={selectedContacts.map((c) => {
                    const labelBits = [
                      c.label ? toProperCase(c.label) : null,
                      c.isPrimary ? "Primary" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <MobileDataCard
                        key={c._id}
                        title={formatCustomerName(c.first, c.last) || "—"}
                        subtitle={labelBits || undefined}
                        fields={
                          <>
                            <DataField
                              label="Phone"
                              value={formatPhone(c.phone)}
                            />
                            <DataField
                              label="Customer"
                              value={
                                formatCustomerRecordName(c.customer) || "—"
                              }
                            />
                            <DataField
                              label="Renewal"
                              value={formatRenewalDate(c.renewalDueDate)}
                              className="col-span-2"
                            />
                          </>
                        }
                      />
                    );
                  })}
                  desktop={
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
                        <tr>
                          <th className="px-2 py-2 font-medium">Contact</th>
                          <th className="px-2 py-2 font-medium">Phone</th>
                          <th className="px-2 py-2 font-medium">Customer</th>
                          <th className="px-2 py-2 font-medium">Renewal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedContacts.map((c) => (
                          <tr
                            key={c._id}
                            className="border-t border-neutral-100"
                          >
                            <td className="px-2 py-2">
                              <div className="font-medium text-brand-dark">
                                {formatCustomerName(c.first, c.last) || "—"}
                              </div>
                              {c.label ? (
                                <div className="text-[11px] text-neutral-400">
                                  {toProperCase(c.label)}
                                  {c.isPrimary ? " · Primary" : ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-neutral-700">
                              {formatPhone(c.phone)}
                            </td>
                            <td className="px-2 py-2 text-neutral-600">
                              {formatCustomerRecordName(c.customer) || "—"}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-neutral-600">
                              {formatRenewalDate(c.renewalDueDate)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Step navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={stepIndex === 0}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 disabled:opacity-40"
        >
          Back
        </button>
        {step !== "review" ? (
          <button
            type="button"
            onClick={goNext}
            disabled={nextDisabled}
            className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Confirm dialog */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">
              Confirm bulk send
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              Send this message to <strong>{selectedIds.size}</strong>{" "}
              recipient
              {selectedIds.size === 1 ? "" : "s"} from{" "}
              <strong>{effectiveFromNumber}</strong>?
            </p>
            <p className="mt-2 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 whitespace-pre-wrap">
              {previewText || body}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                onClick={onCloseConfirm}
                disabled={sending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
                onClick={onConfirmSend}
                disabled={sending}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Send now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
