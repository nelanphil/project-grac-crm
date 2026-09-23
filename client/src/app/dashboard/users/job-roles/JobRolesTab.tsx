"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import JobRoleFieldsRenderer from "@/components/users/JobRoleFieldsRenderer";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  JOB_ROLE_FIELD_TYPES,
  JobRoleField,
  JobRoleFieldType,
  JobRoleItem,
  createJobRole,
  deleteJobRole,
  getJobRoles,
  updateJobRole,
} from "@/lib/api";

const FIELD_TYPE_LABELS: Record<JobRoleFieldType, string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  phone: "Phone",
  email: "Email",
};

function slugKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]/, "f$&")
    .slice(0, 40);
}

function blankField(order: number): JobRoleField & { id: string } {
  return {
    id: `new-${Date.now()}-${order}`,
    key: "",
    label: "",
    type: "text",
    required: false,
    options: [],
    helpText: "",
    order,
  };
}

type DraftField = JobRoleField & { id: string };

function toDraft(role: JobRoleItem | null): {
  label: string;
  description: string;
  color: string;
  schedulable: boolean;
  territoryOwner: boolean;
  fields: DraftField[];
} {
  return {
    label: role?.label ?? "",
    description: role?.description ?? "",
    color: role?.color ?? "#44403c",
    schedulable: role?.capabilities.schedulable ?? false,
    territoryOwner: role?.capabilities.territoryOwner ?? false,
    fields: (role?.fields ?? []).map((field, index) => ({
      ...field,
      id: field.key || `field-${index}`,
      order: index,
    })),
  };
}

function SortableField({
  field,
  onChange,
  onRemove,
}: {
  field: DraftField;
  onChange: (patch: Partial<DraftField>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: field.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const needsOptions = field.type === "select" || field.type === "multiselect";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-neutral-200 bg-white p-3"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-2 cursor-grab text-neutral-400"
          aria-label="Reorder field"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={field.label}
              onChange={(e) => {
                const label = e.target.value;
                onChange({
                  label,
                  key: field.key && field.key !== slugKey(field.label) ? field.key : slugKey(label),
                });
              }}
              placeholder="Field label"
              className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-brand-orange"
            />
            <select
              value={field.type}
              onChange={(e) =>
                onChange({ type: e.target.value as JobRoleFieldType })
              }
              className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-brand-orange"
            >
              {JOB_ROLE_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={field.key}
              onChange={(e) => onChange({ key: slugKey(e.target.value) })}
              placeholder="field_key"
              className="rounded-md border border-neutral-200 px-2 py-1.5 font-mono text-xs outline-none focus:border-brand-orange"
            />
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => onChange({ required: e.target.checked })}
                className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
              />
              Required
            </label>
          </div>
          {needsOptions ? (
            <input
              value={field.options.join(", ")}
              onChange={(e) =>
                onChange({
                  options: e.target.value
                    .split(",")
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Options, separated by commas"
              className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-brand-orange"
            />
          ) : null}
          <input
            value={field.helpText}
            onChange={(e) => onChange({ helpText: e.target.value })}
            placeholder="Help text (optional)"
            className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-brand-orange"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 text-neutral-400 hover:text-red-600"
          aria-label="Remove field"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function JobRolesTab() {
  const token = useAuthStore((s) => s.token);
  const [roles, setRoles] = useState<JobRoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(toDraft(null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (!token) return;
    getJobRoles(token)
      .then(({ jobRoles }) => {
        setRoles(jobRoles);
        if (jobRoles[0]) {
          setSelectedId(jobRoles[0]._id);
          setDraft(toDraft(jobRoles[0]));
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load job roles."),
      )
      .finally(() => setLoading(false));
  }, [token]);

  const selected = useMemo(
    () => roles.find((role) => role._id === selectedId) ?? null,
    [roles, selectedId],
  );

  function openRole(role: JobRoleItem) {
    setSelectedId(role._id);
    setDraft(toDraft(role));
    setPreview({});
    setSaveError(null);
  }

  function openNew() {
    setSelectedId("new");
    setDraft(toDraft(null));
    setPreview({});
    setSaveError(null);
  }

  function patchField(id: string, patch: Partial<DraftField>) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((current) => {
      const oldIndex = current.fields.findIndex((field) => field.id === active.id);
      const newIndex = current.fields.findIndex((field) => field.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return { ...current, fields: arrayMove(current.fields, oldIndex, newIndex) };
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedId) return;
    setSaving(true);
    setSaveError(null);
    const fields: JobRoleField[] = draft.fields.map((field, index) => ({
      key: field.key || slugKey(field.label),
      label: field.label.trim(),
      type: field.type,
      required: field.required,
      options: field.options,
      helpText: field.helpText.trim(),
      order: index,
    }));
    if (fields.some((field) => !field.label || !field.key)) {
      setSaveError("Every field needs a label.");
      setSaving(false);
      return;
    }
    const payload = {
      label: draft.label.trim(),
      description: draft.description.trim(),
      color: draft.color,
      capabilities: {
        schedulable: draft.schedulable,
        territoryOwner: draft.territoryOwner,
      },
      fields,
    };
    try {
      if (selectedId === "new") {
        const { jobRole } = await createJobRole(token, payload);
        setRoles((prev) => [...prev, jobRole].sort((a, b) => a.label.localeCompare(b.label)));
        setSelectedId(jobRole._id);
        setDraft(toDraft(jobRole));
      } else {
        const { jobRole } = await updateJobRole(token, selectedId, payload);
        setRoles((prev) => prev.map((role) => (role._id === jobRole._id ? jobRole : role)));
        setDraft(toDraft(jobRole));
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save job role.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !selected || selected.isSystem) return;
    if (!window.confirm(`Delete the ${selected.label} job role?`)) return;
    try {
      await deleteJobRole(token, selected._id);
      const next = roles.filter((role) => role._id !== selected._id);
      setRoles(next);
      if (next[0]) openRole(next[0]);
      else setSelectedId(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const force = window.confirm(
          `${err.message}. Remove it from those users and delete the job role?`,
        );
        if (!force) return;
        try {
          await deleteJobRole(token, selected._id, true);
          const next = roles.filter((role) => role._id !== selected._id);
          setRoles(next);
          if (next[0]) openRole(next[0]);
          else setSelectedId(null);
          return;
        } catch (forceErr) {
          setSaveError(
            forceErr instanceof ApiError ? forceErr.message : "Failed to delete job role.",
          );
          return;
        }
      }
      setSaveError(err instanceof ApiError ? err.message : "Failed to delete job role.");
    }
  }

  const schedulableLocked = selected?.isSystem && selected.slug === "technician";
  const territoryLocked = selected?.isSystem && selected.slug === "territory-owner";
  const previewRole = {
    label: draft.label || "Job role",
    color: draft.color,
    fields: draft.fields.map((field, index) => ({ ...field, order: index })),
  };

  if (loading) {
    return <div className="text-sm text-neutral-500 py-6">Loading job roles…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Job roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Job roles describe what staff do. Security roles still control access.
            Schedulable roles appear on the work-order board. Territory owners can
            be matched to customers through territories.
          </p>
        </div>
        <button type="button" onClick={openNew} className="btn-primary text-sm px-4 py-2">
          New job role
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <ul className="divide-y divide-neutral-100">
            {roles.map((role) => (
              <li key={role._id}>
                <button
                  type="button"
                  onClick={() => openRole(role)}
                  className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm ${
                    selectedId === role._id
                      ? "bg-brand-dark/5 text-brand-dark"
                      : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{role.label}</span>
                    <span className="block text-xs text-neutral-500">
                      {[
                        role.capabilities.schedulable ? "Schedulable" : null,
                        role.capabilities.territoryOwner ? "Territory" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No capabilities"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {roles.length === 0 ? (
              <li className="px-4 py-6 text-sm text-neutral-500">No job roles yet.</li>
            ) : null}
          </ul>
        </aside>

        {selectedId ? (
          <form
            onSubmit={handleSave}
            className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6"
          >
            {saveError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {saveError}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="block text-sm font-medium text-brand-dark">Name</label>
                <input
                  required
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-brand-dark">Color</label>
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                  className="mt-1 h-10 w-16 cursor-pointer rounded-md border border-neutral-200 bg-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-dark">Description</label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
                className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={draft.schedulable}
                  disabled={schedulableLocked}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, schedulable: e.target.checked }))
                  }
                  className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                />
                Schedulable for work orders
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={draft.territoryOwner}
                  disabled={territoryLocked}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, territoryOwner: e.target.checked }))
                  }
                  className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                />
                Territory owner
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-brand-dark">Fields</p>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      fields: [...d.fields, blankField(d.fields.length)],
                    }))
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-orange hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add field
                </button>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={draft.fields.map((field) => field.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {draft.fields.map((field) => (
                      <SortableField
                        key={field.id}
                        field={field}
                        onChange={(patch) => patchField(field.id, patch)}
                        onRemove={() =>
                          setDraft((d) => ({
                            ...d,
                            fields: d.fields.filter((item) => item.id !== field.id),
                          }))
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              {draft.fields.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No extra fields. Capabilities still control scheduling and territories.
                </p>
              ) : null}
            </div>

            <JobRoleFieldsRenderer
              title={`${draft.label || "Preview"} preview`}
              color={draft.color}
              fields={previewRole.fields}
              values={preview}
              onChange={(key, value) =>
                setPreview((current) => ({ ...current, [key]: value }))
              }
            />

            <div className="flex items-center justify-between gap-2 pt-2">
              {selected && !selected.isSystem ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="text-sm font-medium text-red-600 hover:underline"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={saving}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
              >
                {saving ? "Saving…" : selectedId === "new" ? "Create" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-200 px-6 py-12 text-center text-sm text-neutral-500">
            Select a job role or create one.
          </div>
        )}
      </div>
    </div>
  );
}
