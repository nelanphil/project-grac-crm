"use client";

import { useEffect, useState } from "react";
import InvoiceTemplateCanvas from "@/components/billing/invoice-template/InvoiceTemplateCanvas";
import InvoiceTemplateSidebar from "@/components/billing/invoice-template/InvoiceTemplateSidebar";
import {
  ApiError,
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  getInvoiceTemplates,
  updateInvoiceTemplate,
  uploadInvoiceTemplateImage,
  type InvoiceTemplateItem,
} from "@/lib/api";
import {
  SAMPLE_INVOICE,
  createBlock,
  defaultInvoiceBlocks,
  duplicateBlock,
  findBlock,
  insertBlock,
  insertIntoColumn,
  moveBlock,
  normalizeBlocks,
  patchBlock,
  removeBlock,
  reorderBlock,
  withNewIds,
  type InvoiceBlock,
  type InvoiceBlockType,
  type InvoiceLeafBlock,
} from "@/lib/invoice-template";
import { useAuthStore } from "@/store/useAuthStore";

interface Draft {
  name: string;
  isDefault: boolean;
  blocks: InvoiceBlock[];
}

function toDraft(template: InvoiceTemplateItem): Draft {
  return {
    name: template.name,
    isDefault: template.isDefault,
    blocks: normalizeBlocks(template.blocks),
  };
}

export default function InvoiceTemplateTab() {
  const token = useAuthStore((s) => s.token);
  const [templates, setTemplates] = useState<InvoiceTemplateItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function applyTemplate(template: InvoiceTemplateItem, list = templates) {
    setTemplates(list);
    setSelectedId(template._id);
    setDraft(toDraft(template));
    setBlockId(null);
    setDirty(false);
    setSaved(false);
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getInvoiceTemplates(token)
      .then(({ templates: list }) => {
        if (cancelled) return;
        setTemplates(list);
        const initial = list.find((item) => item.isDefault) ?? list[0];
        if (initial) {
          setSelectedId(initial._id);
          setDraft(toDraft(initial));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load templates.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function updateDraft(next: Draft) {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  }

  function confirmDiscard(): boolean {
    if (!dirty) return true;
    return window.confirm("Discard unsaved changes to this template?");
  }

  function selectTemplate(id: string) {
    if (id === selectedId) return;
    if (!confirmDiscard()) return;
    const template = templates.find((item) => item._id === id);
    if (!template) return;
    setSelectedId(id);
    setDraft(toDraft(template));
    setBlockId(null);
    setDirty(false);
    setError(null);
    setSaved(false);
  }

  async function refresh(preferId?: string) {
    if (!token) return;
    const { templates: list } = await getInvoiceTemplates(token);
    setTemplates(list);
    const next =
      list.find((item) => item._id === (preferId ?? selectedId)) ??
      list.find((item) => item.isDefault) ??
      list[0];
    if (next) applyTemplate(next, list);
  }

  async function save() {
    if (!token || !draft || !selectedId || saving) return;
    const name = draft.name.trim();
    if (!name) {
      setError("Give the template a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateInvoiceTemplate(token, selectedId, {
        name,
        isDefault: draft.isDefault,
        blocks: draft.blocks,
      });
      await refresh(selectedId);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save the template.");
    } finally {
      setSaving(false);
    }
  }

  async function createTemplate() {
    if (!token || saving) return;
    if (!confirmDiscard()) return;
    setSaving(true);
    setError(null);
    try {
      const { template } = await createInvoiceTemplate(token, {
        name: "Untitled template",
        isDefault: false,
        blocks: defaultInvoiceBlocks(),
      });
      await refresh(template._id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create a template.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateTemplate() {
    if (!token || !draft || saving) return;
    if (dirty && !window.confirm("Duplicate the template, including unsaved changes?")) return;
    setSaving(true);
    setError(null);
    try {
      const { template } = await createInvoiceTemplate(token, {
        name: `${draft.name.trim() || "Template"} copy`.slice(0, 80),
        isDefault: false,
        blocks: withNewIds(draft.blocks),
      });
      await refresh(template._id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to duplicate the template.");
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate() {
    if (!token || !selectedId || templates.length < 2 || saving) return;
    const current = templates.find((item) => item._id === selectedId);
    if (!window.confirm(`Delete ${current?.name || "this template"}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const { defaultId } = await deleteInvoiceTemplate(token, selectedId);
      await refresh(defaultId || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete the template.");
    } finally {
      setSaving(false);
    }
  }

  function changeBlocks(blocks: InvoiceBlock[], nextBlockId = blockId) {
    if (!draft) return;
    updateDraft({ ...draft, blocks });
    setBlockId(nextBlockId);
  }

  async function uploadImage(file: File) {
    if (!token || !draft || !blockId) return;
    const selected = findBlock(draft.blocks, blockId);
    if (!selected || selected.type !== "image") return;
    setUploading(true);
    setUploadError(null);
    try {
      const { url } = await uploadInvoiceTemplateImage(token, file);
      changeBlocks(patchBlock(draft.blocks, blockId, { url }));
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
        Loading invoice templates…
      </div>
    );
  }

  if (!draft || !selectedId) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
        No invoice template is available yet.
      </div>
    );
  }

  const selected = findBlock(draft.blocks, blockId);
  const serverTemplate = templates.find((item) => item._id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="invoice-template-picker">
            Invoice template
          </label>
          <select
            id="invoice-template-picker"
            value={selectedId}
            onChange={(event) => selectTemplate(event.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange sm:max-w-xs"
          >
            {templates.map((template) => (
              <option key={template._id} value={template._id}>
                {template.name}
                {template.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void createTemplate()}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              New
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void duplicateTemplate()}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Duplicate
            </button>
            <button
              type="button"
              disabled={saving || templates.length < 2}
              onClick={() => void removeTemplate()}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saved && !dirty ? (
            <span className="text-xs font-medium text-emerald-700">Saved</span>
          ) : null}
          {dirty ? <span className="text-xs text-neutral-500">Unsaved changes</span> : null}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <InvoiceTemplateCanvas
          blocks={draft.blocks}
          invoice={SAMPLE_INVOICE}
          selectedId={blockId}
          onSelect={setBlockId}
          onTextChange={(id, html) => changeBlocks(patchBlock(draft.blocks, id, { html }), id)}
          onReorder={(activeId, overId) => changeBlocks(reorderBlock(draft.blocks, activeId, overId))}
          onAddText={(columnId, side) => {
            const block = createBlock("text");
            if (block.type !== "text") return;
            changeBlocks(insertIntoColumn(draft.blocks, columnId, side, block), block.id);
          }}
        />
        <InvoiceTemplateSidebar
          name={draft.name}
          isDefault={draft.isDefault}
          defaultLocked={Boolean(serverTemplate?.isDefault)}
          blocks={draft.blocks}
          selected={selected}
          uploading={uploading}
          uploadError={uploadError}
          onNameChange={(name) => updateDraft({ ...draft, name })}
          onDefaultChange={(isDefault) => {
            if (serverTemplate?.isDefault && !isDefault) return;
            updateDraft({ ...draft, isDefault });
          }}
          onClearSelection={() => setBlockId(null)}
          onChangeSelected={(patch) => {
            if (!blockId) return;
            changeBlocks(patchBlock(draft.blocks, blockId, patch));
          }}
          onMove={(direction) => {
            if (!blockId) return;
            changeBlocks(moveBlock(draft.blocks, blockId, direction));
          }}
          onDuplicate={() => {
            if (!blockId) return;
            const next = duplicateBlock(draft.blocks, blockId);
            changeBlocks(next.blocks, next.id);
          }}
          onDelete={() => {
            if (!blockId) return;
            changeBlocks(removeBlock(draft.blocks, blockId), null);
          }}
          onAdd={(type: InvoiceBlockType) => {
            const block = createBlock(type);
            if (selected?.type === "columns" && block.type !== "columns") {
              changeBlocks(
                insertIntoColumn(draft.blocks, selected.id, "left", block as InvoiceLeafBlock),
                block.id,
              );
              return;
            }
            changeBlocks(insertBlock(draft.blocks, block, blockId), block.id);
          }}
          onUploadImage={(file) => void uploadImage(file)}
        />
      </div>
    </div>
  );
}
