"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  createNoteTemplate,
  deleteNoteTemplate,
  getNoteTemplates,
  NoteTemplateItem,
  updateNoteTemplate,
} from "@/lib/api";

type FormState = {
  name: string;
  body: string;
};

const EMPTY_FORM: FormState = { name: "", body: "" };

export default function NoteTemplatesCard() {
  const token = useAuthStore((s) => s.token);

  const [templates, setTemplates] = useState<NoteTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getNoteTemplates(token)
      .then(({ templates: list }) =>
        setTemplates(list.filter((item) => item.scope === "global")),
      )
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load note templates.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(template: NoteTemplateItem) {
    setEditingId(template._id);
    setForm({ name: template.name, body: template.body });
    setSaveError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const name = form.name.trim();
    const body = form.body.trim();
    if (!name || !body) {
      setSaveError("Name and body are required.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        const { template } = await updateNoteTemplate(token, editingId, {
          name,
          body,
        });
        setTemplates((prev) =>
          prev
            .map((item) => (item._id === template._id ? template : item))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else {
        const { template } = await createNoteTemplate(token, {
          name,
          body,
          scope: "global",
        });
        setTemplates((prev) =>
          [...prev.filter((item) => item._id !== template._id), template].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
        );
      }
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save note template.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (!window.confirm("Delete this global note template?")) return;
    setDeletingId(id);
    try {
      await deleteNoteTemplate(token, id);
      setTemplates((prev) => prev.filter((item) => item._id !== id));
      if (editingId === id) closeForm();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete note template.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 shadow-sm">
        Loading note templates…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Global note templates
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Canned notes available to every staff user when posting on a work
            order. Staff can still save their own personal templates from the
            work order notes composer.
          </p>
        </div>
        {!formOpen ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            <Plus className="h-4 w-4" />
            Add template
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {formOpen ? (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 border-b border-neutral-100 px-6 py-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId ? "Edit template" : "Add template"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {saveError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          ) : null}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Name</span>
            <input
              required
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Body</span>
            <textarea
              required
              rows={5}
              value={form.body}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, body: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : editingId ? "Save template" : "Create template"}
          </button>
        </form>
      ) : null}

      {templates.length === 0 ? (
        <p className="px-6 py-8 text-sm text-neutral-500">
          No global note templates yet.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {templates.map((template) => (
            <li
              key={template._id}
              className="flex items-start justify-between gap-3 px-6 py-4"
            >
              <div>
                <p className="text-sm font-medium text-brand-dark">
                  {template.name}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">
                  {template.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(template)}
                  className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label={`Edit ${template.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(template._id)}
                  disabled={deletingId === template._id}
                  className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                  aria-label={`Delete ${template.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
