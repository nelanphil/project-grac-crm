"use client";

import { FormEvent, useEffect, useState } from "react";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  ContractTemplateItem,
  createContractTemplate,
  deleteContractTemplate,
  duplicateContractTemplate,
  getContractTemplates,
  updateContractTemplate,
} from "@/lib/api";
import LucideIconByName from "@/components/icons/LucideIconByName";
import LucideIconPicker from "@/components/icons/LucideIconPicker";

type FormState = {
  label: string;
  cost: string;
  body: string;
  badgeIcon: string;
};

const EMPTY_FORM: FormState = {
  label: "",
  cost: "0",
  body: "",
  badgeIcon: "scroll-text",
};

function formatCost(cost: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cost);
}

export default function ContractsCard() {
  const token = useAuthStore((s) => s.token);

  const [templates, setTemplates] = useState<ContractTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  async function loadTemplates(authToken: string) {
    const { templates: list } = await getContractTemplates(authToken, {
      includeDeleted: true,
    });
    setTemplates(list);
  }

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);
    loadTemplates(token)
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load contract catalog.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(template: ContractTemplateItem) {
    setEditingId(template._id);
    setForm({
      label: template.label,
      cost: String(template.cost ?? 0),
      body: template.body ?? "",
      badgeIcon: template.badgeIcon || "scroll-text",
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    const cost = Number.parseFloat(form.cost);
    if (Number.isNaN(cost) || cost < 0) {
      setSaveError("Cost must be a non-negative number.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        label: form.label.trim(),
        body: form.body,
        cost,
        badgeIcon: form.badgeIcon || "scroll-text",
      };

      if (editingId) {
        const { template } = await updateContractTemplate(
          token,
          editingId,
          payload,
        );
        setTemplates((prev) =>
          prev.map((t) => (t._id === template._id ? template : t)),
        );
      } else {
        const { template } = await createContractTemplate(token, payload);
        setTemplates((prev) =>
          [...prev, template].sort((a, b) => a.label.localeCompare(b.label)),
        );
      }
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save contract.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(id: string) {
    if (!token) return;
    setDuplicatingId(id);
    setError(null);
    try {
      const { template } = await duplicateContractTemplate(token, id);
      setTemplates((prev) =>
        [...prev, template].sort((a, b) => a.label.localeCompare(b.label)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to duplicate contract.",
      );
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (
      !window.confirm(
        "Soft-delete this contract? Customers already assigned to it will keep their existing assignment.",
      )
    ) {
      return;
    }

    setDeletingId(id);
    setError(null);
    try {
      const { template } = await deleteContractTemplate(token, id);
      setTemplates((prev) =>
        prev.map((t) => (t._id === template._id ? template : t)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete contract.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading contract catalog…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">Contracts</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Manage the contract catalog — labels, body content, cost, and badge
            icons. Soft-deleted contracts stay available for customers already
            assigned to them.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            <Plus className="h-4 w-4" />
            Add contract
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 border-b border-neutral-100 px-6 py-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId ? "Edit contract" : "Add contract"}
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
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Label
              </span>
              <input
                required
                value={form.label}
                onChange={(e) => field("label", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Service Contract"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Cost (USD)
              </span>
              <input
                required
                type="number"
                min={0}
                step="0.01"
                value={form.cost}
                onChange={(e) => field("cost", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="0.00"
              />
            </label>

            <div className="sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Badge icon
              </span>
              <div className="mt-1">
                <LucideIconPicker
                  value={form.badgeIcon}
                  onChange={(name) => field("badgeIcon", name)}
                />
              </div>
            </div>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Body / content
              </span>
              <textarea
                value={form.body}
                onChange={(e) => field("body", e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Contract terms and content…"
              />
            </label>
          </div>

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
              {saving
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Create contract"}
            </button>
          </div>
        </form>
      )}

      {templates.length === 0 ? (
        <div className="px-6 py-8 text-sm text-neutral-500">
          No contracts in the catalog yet. Add one to define labels, content,
          and pricing.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-100 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Contract
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Cost
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Status
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {templates.map((template) => {
                const isDeleted = Boolean(template.deletedAt);
                return (
                  <tr
                    key={template._id}
                    className={isDeleted ? "bg-neutral-50/80" : undefined}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white">
                          <LucideIconByName
                            name={template.badgeIcon}
                            className="h-4 w-4 text-brand-dark"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-brand-dark">
                            {template.label}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            <span className="font-mono">{template.slug}</span>
                            {template.body?.trim()
                              ? ` · ${template.body.trim().slice(0, 60)}${template.body.trim().length > 60 ? "…" : ""}`
                              : " · No body yet"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                      {formatCost(template.cost)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={
                          isDeleted
                            ? "inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
                            : "inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                        }
                      >
                        {isDeleted ? "Deleted" : "Active"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      {!isDeleted && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(template)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
                            aria-label={`Edit ${template.label}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(template._id)}
                            disabled={duplicatingId === template._id}
                            className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark disabled:opacity-50"
                            aria-label={`Duplicate ${template.label}`}
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(template._id)}
                            disabled={deletingId === template._id}
                            className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            aria-label={`Delete ${template.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
