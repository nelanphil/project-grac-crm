"use client";

import { RefObject } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { MergeFieldItem, MessageTemplateItem } from "@/lib/api";
import PhonePreview from "./PhonePreview";

type TemplatesPanelProps = {
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
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  body: string;
  onBodyChange: (value: string) => void;

  previewText: string;
  previewContactLabel?: string;
  previewSample: boolean;

  error: string | null;
};

export default function TemplatesPanel({
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
  body,
  onBodyChange,
  previewText,
  previewContactLabel,
  previewSample,
  error,
}: TemplatesPanelProps) {
  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Templates list */}
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
              No saved templates yet. Compose a message and save it.
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

        {/* Composer */}
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
            rows={10}
            maxLength={1600}
            className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
            placeholder="Write your SMS template…"
          />
          <p className="mt-1 text-right text-[11px] text-neutral-400">
            {body.length}/1600
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            Pick a template and recipients in the Create tab to send a message.
          </p>
        </section>

        {/* Phone preview */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-brand-dark">
            Phone preview
          </h2>
          <p className="mb-4 text-xs text-neutral-500">
            {previewSample
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
    </div>
  );
}
