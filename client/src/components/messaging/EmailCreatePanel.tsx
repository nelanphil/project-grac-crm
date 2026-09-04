"use client";

import { RefObject, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  Loader2,
  Mail,
  Square,
} from "lucide-react";
import {
  EmailSendAccountItem,
  EmailSendResponse,
  MergeFieldItem,
  MessageTemplateItem,
  MessagingContactItem,
} from "@/lib/api";
import {
  formatCustomerName,
  formatCustomerRecordName,
  toProperCase,
} from "@/lib/formatName";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { EmailChrome, isEmailBodyEmpty } from "@/lib/emailChrome";
import { EmailBodyEditorHandle } from "./EmailBodyEditor";
import EmailPreview from "./EmailPreview";
import EmailTemplateWorkspace from "./EmailTemplateWorkspace";

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
  { key: "account", label: "Configuration" },
  { key: "review", label: "Review & send" },
] as const;

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

type EmailCreatePanelProps = {
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
  loadingTemplates: boolean;
  selectedTemplateId: string | null;
  onSelectTemplate: (template: MessageTemplateItem) => void;
  onStartNewTemplate: () => void;
  onDeleteTemplate: (id: string) => void;

  templateName: string;
  onTemplateNameChange: (value: string) => void;
  savingTemplate: boolean;
  onSaveTemplate: () => void;

  mergeFields: MergeFieldItem[];
  onInsertMergeField: (key: string) => void;
  bodyRef: RefObject<EmailBodyEditorHandle | null>;
  subjectRef: RefObject<HTMLInputElement | null>;
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  emailChrome: EmailChrome;
  onEmailChromeChange: (value: EmailChrome) => void;

  accounts: EmailSendAccountItem[];
  accountId: string;
  onAccountIdChange: (value: string) => void;
  fromNickname: string;
  onFromNicknameChange: (value: string) => void;
  replyTo: string;
  onReplyToChange: (value: string) => void;
  emailsPerSecond: number;
  onEmailsPerSecondChange: (value: number) => void;

  sending: boolean;
  confirmOpen: boolean;
  onOpenConfirm: () => void;
  onCloseConfirm: () => void;
  onConfirmSend: () => void;
  onCancelFlow: () => void;

  previewSubject: string;
  previewHtml: string;
  previewFromLabel?: string;
  previewToLabel?: string;
  previewSample: boolean;

  error: string | null;
  sendResult: EmailSendResponse | null;
  onDismissSendResult: () => void;

  showPaymentLinkColumn?: boolean;
};

function PaymentLinkStatus({ available }: { available?: boolean }) {
  if (available) {
    return (
      <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
        Will send
      </span>
    );
  }
  return (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
      No button
    </span>
  );
}

export default function EmailCreatePanel({
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
  loadingTemplates,
  selectedTemplateId,
  onSelectTemplate,
  onStartNewTemplate,
  onDeleteTemplate,
  templateName,
  onTemplateNameChange,
  savingTemplate,
  onSaveTemplate,
  mergeFields,
  onInsertMergeField,
  bodyRef,
  subjectRef,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  emailChrome,
  onEmailChromeChange,
  accounts,
  accountId,
  onAccountIdChange,
  fromNickname,
  onFromNicknameChange,
  replyTo,
  onReplyToChange,
  emailsPerSecond,
  onEmailsPerSecondChange,
  sending,
  confirmOpen,
  onOpenConfirm,
  onCloseConfirm,
  onConfirmSend,
  onCancelFlow,
  previewSubject,
  previewHtml,
  previewFromLabel,
  previewToLabel,
  previewSample,
  error,
  sendResult,
  onDismissSendResult,
  showPaymentLinkColumn = false,
}: EmailCreatePanelProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [maxStepIndex, setMaxStepIndex] = useState(0);

  const totalPages = Math.max(1, Math.ceil(contactsTotal / pageSize));
  const pageAllSelected =
    contacts.length > 0 && contacts.every((c) => selectedIds.has(c._id));

  const step = STEPS[stepIndex].key;
  const selectedAccount = accounts.find((a) => a._id === accountId);

  const nextDisabled =
    (step === "recipients" && selectedIds.size === 0) ||
    (step === "message" &&
      (!subject.trim() || isEmailBodyEmpty(body))) ||
    (step === "account" && !accountId);

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

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-brand-dark">Email Wizard</h2>
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
              placeholder="Search contacts by name or email…"
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
                No contacts with valid email addresses found.
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
                        checked ? "border-brand-orange/40 bg-orange-50/40" : ""
                      }
                      fields={
                        <>
                          <DataField label="Email" value={c.email || "—"} />
                          <DataField
                            label="Customer"
                            value={formatCustomerRecordName(c.customer) || "—"}
                          />
                          {useRenewalsFilter ? (
                            <DataField
                              label="Renewal"
                              value={formatRenewalDate(c.renewalDueDate)}
                              className="col-span-2"
                            />
                          ) : null}
                          {showPaymentLinkColumn ? (
                            <DataField
                              label="Payment button"
                              value={
                                <PaymentLinkStatus
                                  available={c.hasPayableInvoice}
                                />
                              }
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
                        <th className="px-2 py-2 font-medium">Email</th>
                        <th className="px-2 py-2 font-medium">Customer</th>
                        {useRenewalsFilter ? (
                          <th className="px-2 py-2 font-medium">Renewal</th>
                        ) : null}
                        {showPaymentLinkColumn ? (
                          <th className="px-2 py-2 font-medium">
                            Payment button
                          </th>
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
                            <td className="px-2 py-2 text-neutral-700">
                              {c.email || "—"}
                            </td>
                            <td className="px-2 py-2 text-neutral-600">
                              {formatCustomerRecordName(c.customer) || "—"}
                            </td>
                            {useRenewalsFilter ? (
                              <td className="px-2 py-2 whitespace-nowrap text-neutral-600">
                                {formatRenewalDate(c.renewalDueDate)}
                              </td>
                            ) : null}
                            {showPaymentLinkColumn ? (
                              <td className="px-2 py-2">
                                <PaymentLinkStatus
                                  available={c.hasPayableInvoice}
                                />
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
        <EmailTemplateWorkspace
          templates={templates}
          loadingTemplates={loadingTemplates}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={onSelectTemplate}
          onStartNewTemplate={onStartNewTemplate}
          onDeleteTemplate={onDeleteTemplate}
          templateName={templateName}
          onTemplateNameChange={onTemplateNameChange}
          savingTemplate={savingTemplate}
          onSaveTemplate={onSaveTemplate}
          mergeFields={mergeFields}
          onInsertMergeField={onInsertMergeField}
          bodyRef={bodyRef}
          subjectRef={subjectRef}
          subject={subject}
          onSubjectChange={onSubjectChange}
          body={body}
          onBodyChange={onBodyChange}
          emailChrome={emailChrome}
          onEmailChromeChange={onEmailChromeChange}
          previewSubject={previewSubject}
          previewHtml={previewHtml}
          previewFromLabel={previewFromLabel}
          previewToLabel={previewToLabel}
          previewSample={previewSample}
        />
      ) : null}

      {step === "account" ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-brand-dark">
            Configuration
          </h2>
          <label className="block min-w-[220px] text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Email account
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
                    {a.friendlyName} — {a.fromName} &lt;{a.fromEmail}&gt;
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              From nickname
            </span>
            <input
              type="text"
              value={fromNickname}
              maxLength={120}
              onChange={(e) => onFromNicknameChange(e.target.value)}
              placeholder={selectedAccount?.fromName || "Display name"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Recipients see this name with the account address. It does not
              change the Control Panel account.
            </p>
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Reply-To
            </span>
            <input
              type="email"
              value={replyTo}
              onChange={(e) => onReplyToChange(e.target.value)}
              placeholder="optional@example.com"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Leave blank to omit a Reply-To header.
            </p>
          </label>
          {selectedAccount ? (
            <p className="mt-3 text-sm text-neutral-600">
              Messages will be sent as{" "}
              <strong>
                {fromNickname.trim() || selectedAccount.fromName} &lt;
                {selectedAccount.fromEmail}&gt;
              </strong>
              .
            </p>
          ) : null}
          {accounts.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              Configure an active email account in Control Panel before sending.
            </p>
          ) : null}

          <details className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-neutral-700">
              Advanced
            </summary>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-500">
                Emails per second
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={emailsPerSecond}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  onEmailsPerSecondChange(Math.min(10, Math.max(1, next)));
                }}
                className="w-28 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Paces the bulk send (1–10) to reduce SMTP throttling.
              </p>
            </label>
          </details>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-brand-dark">
              Review
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              <div>
                <dl className="mb-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                    <dt className="text-neutral-500">Recipients</dt>
                    <dd className="font-medium text-brand-dark">
                      {selectedIds.size} selected
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                    <dt className="text-neutral-500">From</dt>
                    <dd className="text-right font-medium text-brand-dark">
                      {selectedAccount
                        ? `${fromNickname.trim() || selectedAccount.fromName} <${selectedAccount.fromEmail}>`
                        : "—"}
                    </dd>
                  </div>
                  {replyTo.trim() ? (
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                      <dt className="text-neutral-500">Reply-To</dt>
                      <dd className="text-right font-medium text-brand-dark">
                        {replyTo.trim()}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                    <dt className="text-neutral-500">Subject</dt>
                    <dd className="max-w-[60%] truncate text-right font-medium text-brand-dark">
                      {previewSubject || subject || "—"}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    disabled={
                      sending ||
                      selectedIds.size === 0 ||
                      !accountId ||
                      !subject.trim() ||
                      isEmailBodyEmpty(body)
                    }
                    onClick={onOpenConfirm}
                    className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <Mail className="h-4 w-4" />
                    Send to {selectedIds.size}
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

              <div className="border-t border-neutral-100 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                <h3 className="text-sm font-semibold text-brand-dark">
                  Email preview
                </h3>
                <p className="mb-4 mt-1 text-xs text-neutral-500">
                  {selectedIds.size === 1
                    ? "Preview uses the selected contact’s data."
                    : "Select a single contact for a live merge preview, or view sample data."}
                </p>
                <EmailPreview
                  fromLabel={previewFromLabel}
                  toLabel={previewToLabel}
                  subject={previewSubject}
                  html={previewHtml}
                  isSample={previewSample}
                  fullWidth
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-brand-dark">
              Recipients ({selectedIds.size})
            </h2>
            {showPaymentLinkColumn ? (
              <p className="mb-3 text-xs text-neutral-500">
                Recipients marked “No button” have no open invoice, so their
                email will omit the Pay securely button.
              </p>
            ) : null}
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
                            <DataField label="Email" value={c.email || "—"} />
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
                            {showPaymentLinkColumn ? (
                              <DataField
                                label="Payment button"
                                value={
                                  <PaymentLinkStatus
                                    available={c.hasPayableInvoice}
                                  />
                                }
                                className="col-span-2"
                              />
                            ) : null}
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
                          <th className="px-2 py-2 font-medium">Email</th>
                          <th className="px-2 py-2 font-medium">Customer</th>
                          <th className="px-2 py-2 font-medium">Renewal</th>
                          {showPaymentLinkColumn ? (
                            <th className="px-2 py-2 font-medium">
                              Payment button
                            </th>
                          ) : null}
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
                            <td className="px-2 py-2 text-neutral-700">
                              {c.email || "—"}
                            </td>
                            <td className="px-2 py-2 text-neutral-600">
                              {formatCustomerRecordName(c.customer) || "—"}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-neutral-600">
                              {formatRenewalDate(c.renewalDueDate)}
                            </td>
                            {showPaymentLinkColumn ? (
                              <td className="px-2 py-2">
                                <PaymentLinkStatus
                                  available={c.hasPayableInvoice}
                                />
                              </td>
                            ) : null}
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

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">
              Confirm bulk send
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              Send this email to <strong>{selectedIds.size}</strong> recipient
              {selectedIds.size === 1 ? "" : "s"} from{" "}
              <strong>
                {selectedAccount
                  ? `${fromNickname.trim() || selectedAccount.fromName} <${selectedAccount.fromEmail}>`
                  : "the selected account"}
              </strong>
              ?
            </p>
            <p className="mt-2 text-xs font-medium text-neutral-500">
              {previewSubject || subject}
            </p>
            <p className="mt-2 max-h-40 overflow-auto rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 whitespace-pre-wrap">
              {body}
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
                  <Mail className="h-4 w-4" />
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
