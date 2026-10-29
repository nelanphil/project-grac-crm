"use client";

import { RefObject } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
  MergeFieldItem,
  MessageTemplateItem,
  MessageTemplateType,
  RenewalPreviewStatus,
  RenewalVariants,
} from "@/lib/api";
import { EmailChrome } from "@/lib/emailChrome";
import PhonePreview from "./PhonePreview";
import { EmailBodyEditorHandle } from "./EmailBodyEditor";
import EmailTemplateWorkspace from "./EmailTemplateWorkspace";

const SMS_BODY_MAX = 1600;

const VARIANT_TABS: { id: RenewalPreviewStatus; label: string }[] = [
  { id: "expired", label: "Expired" },
  { id: "due_soon", label: "Due soon" },
  { id: "active", label: "Active" },
  { id: "fallback", label: "Fallback" },
];

function variantField(
  tab: RenewalPreviewStatus,
): "expired" | "dueSoon" | "active" | null {
  if (tab === "expired") return "expired";
  if (tab === "due_soon") return "dueSoon";
  if (tab === "active") return "active";
  return null;
}

const VARIANT_PLACEHOLDER: Record<RenewalPreviewStatus, string> = {
  expired: "Sent when the renewal date has already passed…",
  due_soon: "Sent when the renewal is due inside the window…",
  active: "Sent when the renewal is still further out…",
  fallback: "Used when there is no renewal date, or a status box is left blank…",
};

type TemplatesPanelProps = {
  templates: MessageTemplateItem[];
  loadingTemplates: boolean;
  selectedTemplateId: string | null;
  onSelectTemplate: (template: MessageTemplateItem) => void;
  onStartNewTemplate: () => void;
  onDeleteTemplate: (id: string) => void;

  templateType: MessageTemplateType;
  onTemplateTypeChange: (type: MessageTemplateType) => void;

  templateName: string;
  onTemplateNameChange: (value: string) => void;
  savingTemplate: boolean;
  onSaveTemplate: () => void;

  mergeFields: MergeFieldItem[];
  onInsertMergeField: (key: string) => void;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  emailEditorRef?: RefObject<EmailBodyEditorHandle | null>;
  subjectRef?: RefObject<HTMLInputElement | null>;
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  renewalVariants: RenewalVariants;
  onRenewalVariantsChange: (value: RenewalVariants) => void;
  variantTab: RenewalPreviewStatus;
  onVariantTabChange: (tab: RenewalPreviewStatus) => void;
  emailChrome: EmailChrome;
  onEmailChromeChange: (value: EmailChrome) => void;

  previewText: string;
  previewSubject: string;
  previewHtml: string;
  previewFromLabel?: string;
  previewToLabel?: string;
  previewContactLabel?: string;
  previewSample: boolean;

  contractTemplates?: { _id: string; label: string; cost: number }[];
  offerContractTemplateId?: string | null;
  onOfferContractTemplateIdChange?: (value: string | null) => void;

  error: string | null;
};

export default function TemplatesPanel({
  templates,
  loadingTemplates,
  selectedTemplateId,
  onSelectTemplate,
  onStartNewTemplate,
  onDeleteTemplate,
  templateType,
  onTemplateTypeChange,
  templateName,
  onTemplateNameChange,
  savingTemplate,
  onSaveTemplate,
  mergeFields,
  onInsertMergeField,
  bodyRef,
  emailEditorRef,
  subjectRef,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  renewalVariants,
  onRenewalVariantsChange,
  variantTab,
  onVariantTabChange,
  emailChrome,
  onEmailChromeChange,
  previewText,
  previewSubject,
  previewHtml,
  previewFromLabel,
  previewToLabel,
  previewContactLabel,
  previewSample,
  contractTemplates,
  offerContractTemplateId,
  onOfferContractTemplateIdChange,
  error,
}: TemplatesPanelProps) {
  const isEmail = templateType === "email";
  const activeVariantField = variantField(variantTab);
  const editingVariant = renewalVariants.enabled && activeVariantField != null;
  const editorValue = editingVariant
    ? renewalVariants[activeVariantField]
    : body;
  const previewTabLabel =
    VARIANT_TABS.find((tab) => tab.id === variantTab)?.label ?? "Fallback";

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2">
        {(["sms", "email"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onTemplateTypeChange(type)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize ${
              templateType === type
                ? "bg-brand-dark text-white"
                : "border border-neutral-200 bg-white text-neutral-600 hover:border-brand-orange hover:text-brand-orange"
            }`}
          >
            {type === "sms" ? "SMS" : "Email"}
          </button>
        ))}
      </div>

      {isEmail ? (
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
          bodyRef={emailEditorRef}
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
          contractTemplates={contractTemplates}
          offerContractTemplateId={offerContractTemplateId}
          onOfferContractTemplateIdChange={onOfferContractTemplateIdChange}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-brand-dark">
                Templates
              </h2>
              <button
                type="button"
                onClick={onStartNewTemplate}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-orange hover:bg-orange-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
            {loadingTemplates ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : templates.length === 0 ? (
              <p className="text-xs text-neutral-500">
                No saved SMS templates yet. Compose a message and save it.
              </p>
            ) : (
              <ul className="max-h-[520px] space-y-1 overflow-y-auto">
                {templates.map((t) => (
                  <li key={t._id}>
                    <div
                      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                        selectedTemplateId === t._id
                          ? "bg-orange-50 text-brand-dark"
                          : "hover:bg-neutral-50"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left text-sm"
                        onClick={() => onSelectTemplate(t)}
                      >
                        <span className="block truncate font-medium">
                          {t.name}
                        </span>
                        <span className="block truncate text-[11px] text-neutral-400">
                          {t.body || "Empty"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        title="Delete template"
                        onClick={() => onDeleteTemplate(t._id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1 text-sm sm:min-w-[200px]">
                <span className="mb-1 block text-xs font-medium text-neutral-500">
                  Template name
                </span>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => onTemplateNameChange(e.target.value)}
                  placeholder="e.g. Renewal reminder"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                />
              </label>
              <button
                type="button"
                onClick={onSaveTemplate}
                disabled={savingTemplate}
                className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {savingTemplate ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {selectedTemplateId ? "Update" : "Save"} template
              </button>
            </div>

            <label className="mb-3 flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={renewalVariants.enabled}
                onChange={(e) =>
                  onRenewalVariantsChange({
                    ...renewalVariants,
                    enabled: e.target.checked,
                  })
                }
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-brand-dark">
                  Vary message by renewal status
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  Write different wording for expired, due soon, and still-active
                  contracts. Anyone without a renewal date, and any status left
                  blank, gets the fallback message.
                </span>
              </span>
            </label>

            {renewalVariants.enabled ? (
              <>
                <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
                  Due soon means within
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={renewalVariants.dueSoonDays}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      onRenewalVariantsChange({
                        ...renewalVariants,
                        dueSoonDays: Math.min(365, Math.max(1, Math.trunc(next))),
                      });
                    }}
                    className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-brand-orange"
                  />
                  days of the renewal date.
                </label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {VARIANT_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onVariantTabChange(tab.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        variantTab === tab.id
                          ? "bg-brand-dark text-white"
                          : "border border-neutral-200 bg-white text-neutral-600 hover:border-brand-orange hover:text-brand-orange"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

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
              value={editorValue}
              onChange={(e) => {
                const next = e.target.value;
                if (editingVariant && activeVariantField) {
                  onRenewalVariantsChange({
                    ...renewalVariants,
                    [activeVariantField]: next,
                  });
                  return;
                }
                onBodyChange(next);
              }}
              rows={10}
              maxLength={SMS_BODY_MAX}
              className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              placeholder={
                renewalVariants.enabled
                  ? VARIANT_PLACEHOLDER[variantTab]
                  : "Write your SMS template…"
              }
            />
            <p className="mt-1 text-right text-[11px] text-neutral-400">
              {editorValue.length}/{SMS_BODY_MAX}
            </p>
            {onOfferContractTemplateIdChange ? (
              <label className="mt-3 block rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                <span className="font-medium text-brand-dark">
                  Temporary contract
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  When a message from this template includes a payment link,
                  each recipient gets a temporary contract and an open invoice
                  for the catalog contract you pick. The link is locked to that
                  contract invoice and its amount. Other balances are not
                  included. Invoice-originated messages do not create temporary
                  offers. Paying the contract invoice makes the contract
                  permanent.
                </span>
                <select
                  value={offerContractTemplateId ?? ""}
                  onChange={(e) =>
                    onOfferContractTemplateIdChange(e.target.value || null)
                  }
                  className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-orange"
                >
                  <option value="">None</option>
                  {(contractTemplates ?? []).map((template) => (
                    <option key={template._id} value={template._id}>
                      {template.label} (${template.cost})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="mt-2 text-xs text-neutral-400">
              Pick a template and recipients in Message Wizard to send a
              message.
            </p>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2 xl:col-span-1">
            <h2 className="mb-3 text-sm font-semibold text-brand-dark">
              Phone preview
            </h2>
            <p className="mb-4 text-xs text-neutral-500">
              {renewalVariants.enabled
                ? previewSample
                  ? variantTab === "fallback"
                    ? "Previewing the fallback wording with sample contact data."
                    : `Previewing the ${previewTabLabel} wording with sample dates.`
                  : `Previewing the ${previewTabLabel} wording for the selected contact.`
                : previewSample
                  ? "Showing sample contact data."
                  : "Preview uses the selected contact’s data."}
            </p>
            <PhonePreview
              message={previewText}
              contactLabel={previewContactLabel}
              isSample={previewSample}
            />
          </section>
        </div>
      )}
    </div>
  );
}
