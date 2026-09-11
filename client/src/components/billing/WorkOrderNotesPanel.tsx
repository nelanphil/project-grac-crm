"use client";

import { KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createNoteTemplate,
  createWorkOrderNote,
  deleteNoteTemplate,
  deleteWorkOrderNote,
  getNoteTemplates,
  getWorkOrderNotes,
  NoteTemplateItem,
  updateWorkOrderNote,
  WorkOrderNote,
} from "@/lib/api";

const ADMIN_ROLES = new Set(["admin", "super-admin", "owner"]);

function formatNoteDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WorkOrderNotesPanel({
  token,
  workOrderId,
  userId,
  canWrite,
  userRole,
  fallbackContent,
}: {
  token: string;
  workOrderId: string;
  userId: string;
  canWrite: boolean;
  userRole?: string;
  fallbackContent?: string;
}) {
  const isAdmin = Boolean(userRole && ADMIN_ROLES.has(userRole));
  const [notes, setNotes] = useState<WorkOrderNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [visibleToCustomer, setVisibleToCustomer] = useState(true);
  const [adding, setAdding] = useState(false);

  const [templates, setTemplates] = useState<NoteTemplateItem[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveAsGlobal, setSaveAsGlobal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editVisible, setEditVisible] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { notes: fetched } = await getWorkOrderNotes(token, workOrderId);
      setNotes(fetched);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load notes.");
    } finally {
      setLoading(false);
    }
  }, [token, workOrderId]);

  const loadTemplates = useCallback(async () => {
    try {
      const { templates: list } = await getNoteTemplates(token);
      setTemplates(list);
    } catch {
      /* composer still works without templates */
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNotes();
    void loadTemplates();
  }, [loadNotes, loadTemplates]);

  const globalTemplates = useMemo(
    () => templates.filter((t) => t.scope === "global"),
    [templates],
  );
  const personalTemplates = useMemo(
    () => templates.filter((t) => t.scope === "personal"),
    [templates],
  );

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item._id === id);
    if (template) setContent(template.body);
  }

  function stopParentFormSubmit(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
    }
  }

  async function handleAdd() {
    const text = content.trim();
    if (!text) return;
    setAdding(true);
    setError(null);
    try {
      const { note } = await createWorkOrderNote(token, workOrderId, {
        content: text,
        visibleToCustomer,
        ...(templateId ? { templateId } : {}),
      });
      setNotes((prev) => [...prev, note]);
      setContent("");
      setTemplateId("");
      setVisibleToCustomer(true);
      setShowSaveTemplate(false);
      setTemplateName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add note.");
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveTemplate() {
    const name = templateName.trim();
    const body = content.trim();
    if (!name || !body) return;
    setSavingTemplate(true);
    setError(null);
    try {
      const { template } = await createNoteTemplate(token, {
        name,
        body,
        scope: isAdmin && saveAsGlobal ? "global" : "personal",
      });
      setTemplates((prev) =>
        [...prev.filter((item) => item._id !== template._id), template].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      setShowSaveTemplate(false);
      setTemplateName("");
      setSaveAsGlobal(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save template.",
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!window.confirm("Delete this template?")) return;
    try {
      await deleteNoteTemplate(token, id);
      setTemplates((prev) => prev.filter((item) => item._id !== id));
      if (templateId === id) setTemplateId("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete template.",
      );
    }
  }

  function startEdit(note: WorkOrderNote) {
    setEditingNoteId(note._id);
    setEditContent(note.content);
    setEditVisible(note.visibleToCustomer);
  }

  async function handleSaveEdit(noteId: string) {
    const text = editContent.trim();
    if (!text) return;
    setSavingEdit(true);
    setError(null);
    try {
      const { note } = await updateWorkOrderNote(token, workOrderId, noteId, {
        content: text,
        visibleToCustomer: editVisible,
      });
      setNotes((prev) => prev.map((item) => (item._id === noteId ? note : item)));
      setEditingNoteId(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update note.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(noteId: string) {
    setDeletingNoteId(noteId);
    setError(null);
    try {
      await deleteWorkOrderNote(token, workOrderId, noteId);
      setNotes((prev) => prev.filter((item) => item._id !== noteId));
      if (editingNoteId === noteId) setEditingNoteId(null);
      setConfirmingDeleteId(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete note.",
      );
    } finally {
      setDeletingNoteId(null);
    }
  }

  const showFallback =
    notes.length === 0 && Boolean(fallbackContent?.trim()) && !loading;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Notes
      </p>

      {error ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-2 text-sm text-neutral-500 print:hidden">
          Loading notes…
        </p>
      ) : notes.length === 0 && !showFallback ? (
        <p className="mt-2 text-sm text-neutral-500">No notes yet.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {showFallback ? (
            <li className="whitespace-pre-wrap text-sm text-neutral-700">
              {fallbackContent}
            </li>
          ) : null}
          {notes.map((note) => {
            const canEdit =
              canWrite && (note.authorId === userId || isAdmin);
            return (
              <li
                key={note._id}
                className={`rounded-lg px-3 py-3 ${
                  note.visibleToCustomer
                    ? "border border-neutral-100 bg-neutral-50"
                    : "border border-dashed border-neutral-300 bg-neutral-50 print:hidden"
                }`}
              >
                <div className="flex items-start justify-between gap-2 print:hidden">
                  <div>
                    <p className="text-sm font-medium text-brand-dark">
                      {note.author
                        ? `${note.author.first_name} ${note.author.last_name}`.trim() ||
                          "Staff"
                        : "Staff"}
                      {!note.visibleToCustomer ? (
                        <span className="ml-2 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                          Internal
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {formatNoteDate(note.createdAt)}
                      {note.updatedAt !== note.createdAt ? " (edited)" : ""}
                    </p>
                  </div>
                  {canEdit &&
                  editingNoteId !== note._id &&
                  confirmingDeleteId !== note._id ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(note)}
                        className="text-xs font-medium text-brand-orange hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(note._id)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>

                {editingNoteId === note._id ? (
                  <div className="mt-3 space-y-2 print:hidden">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
                    />
                    <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={editVisible}
                        onChange={(e) => setEditVisible(e.target.checked)}
                      />
                      Show on work order & invoice
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveEdit(note._id)}
                        disabled={savingEdit || !editContent.trim()}
                        className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNoteId(null)}
                        disabled={savingEdit}
                        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">
                      {note.content}
                    </p>
                    {confirmingDeleteId === note._id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs print:hidden">
                        <p className="text-red-700">Remove this note?</p>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={deletingNoteId === note._id}
                          className="rounded border border-neutral-300 px-2 py-1 font-medium text-neutral-600 hover:bg-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(note._id)}
                          disabled={deletingNoteId === note._id}
                          className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {deletingNoteId === note._id ? "Deleting…" : "Remove"}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <div
          onKeyDown={stopParentFormSubmit}
          className="mt-4 space-y-2 border-t border-neutral-100 pt-4 print:hidden"
        >
          {templates.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[12rem] flex-1 text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
                  Template
                </span>
                <select
                  value={templateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">Start from a template…</option>
                  {globalTemplates.length > 0 ? (
                    <optgroup label="Global">
                      {globalTemplates.map((template) => (
                        <option key={template._id} value={template._id}>
                          {template.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {personalTemplates.length > 0 ? (
                    <optgroup label="My templates">
                      {personalTemplates.map((template) => (
                        <option key={template._id} value={template._id}>
                          {template.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              {personalTemplates.length > 0 ? (
                <div className="flex flex-wrap gap-1 pb-0.5">
                  {personalTemplates.map((template) => (
                    <button
                      key={template._id}
                      type="button"
                      onClick={() => void handleDeleteTemplate(template._id)}
                      className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:text-red-700"
                      title={`Delete ${template.name}`}
                    >
                      Remove {template.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="Write a note…"
            className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
          />
          <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={visibleToCustomer}
              onChange={(e) => setVisibleToCustomer(e.target.checked)}
            />
            Show on work order & invoice
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={adding || !content.trim()}
              title={!content.trim() ? "Enter a note to post" : undefined}
              onClick={() => void handleAdd()}
              className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {adding ? "Posting…" : "Post note"}
            </button>
            <button
              type="button"
              disabled={!content.trim()}
              onClick={() => setShowSaveTemplate((v) => !v)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Save as template
            </button>
          </div>
          {showSaveTemplate ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <label className="block min-w-[12rem] flex-1 text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
                  Template name
                </span>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>
              {isAdmin ? (
                <label className="inline-flex items-center gap-2 pb-1 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={saveAsGlobal}
                    onChange={(e) => setSaveAsGlobal(e.target.checked)}
                  />
                  Global
                </label>
              ) : null}
              <button
                type="button"
                disabled={savingTemplate || !templateName.trim()}
                onClick={() => void handleSaveTemplate()}
                className="rounded-lg bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {savingTemplate ? "Saving…" : "Save template"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
