"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  ApiError,
  createWorkOrderType,
  deleteWorkOrderType,
  getUsers,
  getWorkOrderTypes,
  updateWorkOrderType,
  UserListItem,
  WorkOrderTypeItem,
  WorkOrderTypeTechnician,
} from "@/lib/api";

type FormState = {
  label: string;
  qualifiedUserRefs: string[];
};

const EMPTY_FORM: FormState = {
  label: "",
  qualifiedUserRefs: [],
};

function technicianName(user: {
  first_name?: string;
  last_name?: string;
}): string {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Unnamed";
}

function formatTechnicianList(users: WorkOrderTypeTechnician[]): string {
  if (users.length === 0) return "All technicians";
  return users.map(technicianName).join(", ");
}

export default function WorkOrderTypesCard() {
  const token = useAuthStore((s) => s.token);

  const [types, setTypes] = useState<WorkOrderTypeItem[]>([]);
  const [staff, setStaff] = useState<UserListItem[]>([]);
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
    Promise.all([getWorkOrderTypes(token), getUsers(token)])
      .then(([{ types: list }, { users }]) => {
        setTypes(list);
        setStaff(
          users.filter(
            (user) => user.schedulable && user.role !== "customer",
          ),
        );
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load work order types.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  const staffOptions = useMemo(() => {
    const byId = new Map<
      string,
      { _id: string; first_name: string; last_name: string }
    >();
    for (const user of staff) {
      byId.set(user._id, {
        _id: user._id,
        first_name: user.first_name,
        last_name: user.last_name,
      });
    }
    const editing = types.find((type) => type._id === editingId);
    for (const user of editing?.qualifiedUsers ?? []) {
      if (!byId.has(user._id)) {
        byId.set(user._id, user);
      }
    }
    return [...byId.values()].sort((a, b) =>
      technicianName(a).localeCompare(technicianName(b)),
    );
  }, [staff, types, editingId]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(type: WorkOrderTypeItem) {
    setEditingId(type._id);
    setForm({
      label: type.label,
      qualifiedUserRefs: [...type.qualifiedUserRefs],
    });
    setSaveError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }

  function toggleTechnician(id: string) {
    setForm((prev) => ({
      ...prev,
      qualifiedUserRefs: prev.qualifiedUserRefs.includes(id)
        ? prev.qualifiedUserRefs.filter((ref) => ref !== id)
        : [...prev.qualifiedUserRefs, id],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    const label = form.label.trim();
    if (!label) {
      setSaveError("Name is required.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const payload = {
      label,
      qualifiedUserRefs: form.qualifiedUserRefs,
    };

    try {
      if (editingId) {
        const { type } = await updateWorkOrderType(token, editingId, payload);
        setTypes((prev) =>
          prev
            .map((item) => (item._id === type._id ? type : item))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } else {
        const { type } = await createWorkOrderType(token, payload);
        setTypes((prev) =>
          [...prev.filter((item) => item._id !== type._id), type].sort((a, b) =>
            a.label.localeCompare(b.label),
          ),
        );
      }
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save work order type.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (
      !window.confirm(
        "Delete this work order type? Existing work orders keep the type label, but it will no longer appear in the picker.",
      )
    ) {
      return;
    }

    setDeletingId(id);
    try {
      await deleteWorkOrderType(token, id);
      setTypes((prev) => prev.filter((type) => type._id !== id));
      if (editingId === id) closeForm();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete work order type.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading work order types…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Work order types
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Types appear on work orders and filter the schedule Suggest list to
            the technicians you assign here. Leave technicians empty to keep
            Suggest open to everyone.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            <Plus className="h-4 w-4" />
            Add type
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="border-b border-neutral-100 px-6 py-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId ? "Edit work order type" : "Add work order type"}
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

          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Name</span>
            <input
              required
              value={form.label}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, label: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="Install"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-neutral-600">
              Qualified technicians
            </legend>
            <p className="text-[11px] text-neutral-500">
              Suggest only shows these technicians when this type is set. If
              none are selected, Suggest uses the full staff list.
            </p>
            {staffOptions.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No schedulable technicians found. Mark staff as schedulable on
                the Users page first.
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2">
                {staffOptions.map((user) => (
                  <label
                    key={user._id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={form.qualifiedUserRefs.includes(user._id)}
                      onChange={() => toggleTechnician(user._id)}
                      className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
                    />
                    <span className="text-sm text-brand-dark">
                      {technicianName(user)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Create type"}
            </button>
          </div>
        </form>
      )}

      {types.length === 0 ? (
        <div className="px-6 py-8 text-sm text-neutral-500">
          No work order types yet. Add a type and assign technicians so Suggest
          can recommend the right people.
        </div>
      ) : (
        <div className="px-4 pb-4 sm:px-0 sm:pb-0">
          <ResponsiveDataView
            mobile={types.map((type) => (
              <MobileDataCard
                key={type._id}
                title={type.label}
                fields={
                  <DataField
                    label="Technicians"
                    value={formatTechnicianList(type.qualifiedUsers)}
                    className="col-span-2"
                  />
                }
                actions={
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => openEdit(type)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
                      aria-label={`Edit ${type.label}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(type._id)}
                      disabled={deletingId === type._id}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={`Delete ${type.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                }
              />
            ))}
            desktop={
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-100 text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Technicians
                      </th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 bg-white">
                    {types.map((type) => (
                      <tr key={type._id}>
                        <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                          {type.label}
                        </td>
                        <td className="px-6 py-4 text-neutral-600">
                          {formatTechnicianList(type.qualifiedUsers)}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEdit(type)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
                            aria-label={`Edit ${type.label}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(type._id)}
                            disabled={deletingId === type._id}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            aria-label={`Delete ${type.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
