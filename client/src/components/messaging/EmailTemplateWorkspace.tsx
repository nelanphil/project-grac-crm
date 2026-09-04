"use client";

import { RefObject, useState } from "react";
import { Loader2, Maximize2, Minimize2, Plus, Save, Trash2 } from "lucide-react";
import { MergeFieldItem, MessageTemplateItem } from "@/lib/api";
import { EmailChrome } from "@/lib/emailChrome";
import EmailBodyEditor, { EmailBodyEditorHandle } from "./EmailBodyEditor";
import EmailChromeFields from "./EmailChromeFields";
import EmailPreview from "./EmailPreview";

const EMAIL_BODY_MAX = 25_000;
const EMAIL_SUBJECT_MAX = 200;

export type EmailTemplateWorkspaceProps = {
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
  bodyRef?: RefObject<EmailBodyEditorHandle | null>;
  subjectRef?: RefObject<HTMLInputElement | null>;
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  emailChrome: EmailChrome;
  onEmailChromeChange: (value: EmailChrome) => void;

  previewSubject: string;
  previewHtml: string;
  previewFromLabel?: string;
  previewToLabel?: string;
  previewSample: boolean;
};

export default function EmailTemplateWorkspace({
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
  previewSubject,
  previewHtml,
  previewFromLabel,
  previewToLabel,
  previewSample,
}: EmailTemplateWorkspaceProps) {
  const [previewExpanded, setPreviewExpanded] = useState(false);

  return (
    <div
      className={
        previewExpanded
          ? "grid grid-cols-1 gap-4"
          : "grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_minmax(340px,520px)]"
      }
    >
      {previewExpanded ? null : (
      <>
      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-dark">Templates</h2>
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
            No saved email templates yet. Compose a message and save it.
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
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block truncate text-[11px] text-neutral-400">
                      {t.subject || t.body || "Empty"}
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
          <label className="min-w-[200px] flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Template name
            </span>
            <input
              type="text"
              value={templateName}
              onChange={(e) => onTemplateNameChange(e.target.value)}
              placeholder="e.g. Renewal reminder email"
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

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Subject
          </span>
          <input
            ref={subjectRef}
            type="text"
            value={subject}
            maxLength={EMAIL_SUBJECT_MAX}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Service renewal reminder"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          />
          <p className="mt-1 text-right text-[11px] text-neutral-400">
            {subject.length}/{EMAIL_SUBJECT_MAX}
          </p>
        </label>

        <div className="mb-4">
          <EmailChromeFields
            value={emailChrome}
            onChange={onEmailChromeChange}
            sections={["header"]}
          />
        </div>

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

        <EmailBodyEditor
          ref={bodyRef}
          value={body}
          onChange={onBodyChange}
          placeholder="Write your email template…"
          maxLength={EMAIL_BODY_MAX}
        />

        <div className="mt-4">
          <EmailChromeFields
            value={emailChrome}
            onChange={onEmailChromeChange}
            showReset={false}
            sections={["footer"]}
          />
        </div>
      </section>
      </>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2 xl:col-span-1">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-brand-dark">
              Email preview
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {previewSample
                ? "Showing sample contact data."
                : "Preview uses the selected contact’s data."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewExpanded((open) => !open)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 hover:text-brand-dark"
          >
            {previewExpanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {previewExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
        <EmailPreview
          fromLabel={previewFromLabel}
          toLabel={previewToLabel}
          subject={previewSubject}
          html={previewHtml}
          isSample={previewSample}
          fullWidth={previewExpanded}
        />
      </section>
    </div>
  );
}
