"use client";

import { useEffect, useState, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { X, Pencil, Trash2, Plus, Check } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getRoles,
  getRolePermissions,
  updateRolePermissions,
  createRole,
  renameRole,
  deleteRole,
  RoleItem,
  ApiError,
} from "@/lib/api";

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
  "leads:read",
  "leads:write",
  "leads:delete",
  "accounts:read",
  "accounts:write",
  "accounts:delete",
  "customers:read",
  "customers:write",
  "customers:delete",
  "users:read",
  "users:write",
  "users:delete",
  "permissions:manage",
  "jobs:read",
  "jobs:write",
  "jobs:delete",
  "reports:read",
].sort();

const ACTION_ORDER = ["read", "write", "delete", "manage"];

function groupPermissions(permissions: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const perm of permissions) {
    const resource = perm.split(":")[0];
    if (!groups[resource]) groups[resource] = [];
    groups[resource].push(perm);
  }
  for (const resource of Object.keys(groups)) {
    groups[resource].sort((a, b) => {
      const ai = ACTION_ORDER.indexOf(a.split(":")[1]);
      const bi = ACTION_ORDER.indexOf(b.split(":")[1]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }
  return groups;
}

// ── Draggable chip ────────────────────────────────────────────────────────────

function DraggableChip({
  id,
  label,
  onRemove,
}: {
  id: string;
  label: string;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.3 : 1,
      }}
      className="flex cursor-grab items-center gap-1 rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-mono text-neutral-700 select-none active:cursor-grabbing hover:bg-neutral-200 transition-colors"
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 rounded text-neutral-400 hover:text-red-500 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function StaticChip({ label }: { label: string }) {
  return (
    <div className="flex cursor-grabbing items-center gap-1 rounded-md bg-brand-orange px-2.5 py-1 text-xs font-mono text-white shadow-lg select-none">
      {label}
    </div>
  );
}

// ── Role card ─────────────────────────────────────────────────────────────────

function RoleCard({
  role,
  permissions,
  savedPermissions,
  onRemovePerm,
  onSave,
  saving,
  saveError,
  saveSuccess,
  onRename,
  onDelete,
}: {
  role: RoleItem;
  permissions: string[];
  savedPermissions: string[];
  onRemovePerm: (perm: string) => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onRename: (
    slug: string,
    newLabel: string,
    newSlug: string,
  ) => Promise<string | null>;
  onDelete: (slug: string) => Promise<void>;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `role:${role.slug}` });

  const [editing, setEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(role.label);
  const [slugValue, setSlugValue] = useState(role.slug);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) labelRef.current?.focus();
  }, [editing]);

  // Keep local values in sync if parent updates the role
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLabelValue(role.label);

      setSlugValue(role.slug);
    }
  }, [role.label, role.slug, editing]);

  const isDirty =
    permissions.length !== savedPermissions.length ||
    [...permissions].sort().join() !== [...savedPermissions].sort().join();

  async function submitRename() {
    const newLabel = labelValue.trim();
    const newSlug = slugValue
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    if (!newLabel || !newSlug) return;
    if (newLabel === role.label && newSlug === role.slug) {
      setEditing(false);
      return;
    }

    setEditSaving(true);
    setEditError(null);
    const err = await onRename(role.slug, newLabel, newSlug);
    setEditSaving(false);
    if (err) {
      setEditError(err);
    } else {
      setEditing(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    await onDelete(role.slug);
    setDeleting(false);
    setDeleteConfirm(false);
  }

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 bg-white p-4 shadow-sm transition-colors ${
        isOver ? "border-brand-orange bg-orange-50" : "border-neutral-200"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-3">
        {/* Label / slug edit */}
        {editing ? (
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 text-right text-xs text-neutral-400">
                    Label
                  </span>
                  <input
                    ref={labelRef}
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      if (e.key === "Escape") setEditing(false);
                    }}
                    className="flex-1 rounded-md border border-brand-orange px-2 py-1 text-sm font-semibold text-brand-dark outline-none"
                    placeholder="Display name"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 text-right text-xs text-neutral-400">
                    Slug
                  </span>
                  <input
                    value={slugValue}
                    onChange={(e) =>
                      setSlugValue(
                        e.target.value
                          .toLowerCase()
                          .replace(/\s+/g, "-")
                          .replace(/[^a-z0-9-]/g, ""),
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      if (e.key === "Escape") setEditing(false);
                    }}
                    className="flex-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-mono text-neutral-600 outline-none focus:border-brand-orange"
                    placeholder="role-slug"
                  />
                </div>
                {editError && (
                  <p className="text-xs text-red-600 pl-14">{editError}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={submitRename}
                  disabled={editSaving}
                  className="rounded p-1 text-brand-orange hover:bg-orange-50 disabled:opacity-60"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setLabelValue(role.label);
                    setSlugValue(role.slug);
                    setEditError(null);
                  }}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-1.5">
            <h3 className="text-sm font-semibold text-brand-dark">
              {role.label}
              <span className="ml-1.5 text-xs font-normal text-neutral-400 font-mono">
                [{role.slug}]
              </span>
              {role.isSystem && (
                <span className="ml-1.5 text-xs font-normal text-neutral-300">
                  system
                </span>
              )}
              <span className="ml-1.5 text-xs font-normal text-neutral-400">
                ({permissions.length})
              </span>
            </h3>
            <button
              onClick={() => setEditing(true)}
              className="rounded p-1 text-neutral-300 hover:text-brand-orange transition-colors"
              title="Edit role name"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Actions right side */}
        <div className="flex items-center gap-2 shrink-0">
          {isDirty && (
            <button
              onClick={onSave}
              disabled={saving}
              className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {!isDirty && saveSuccess && (
            <span className="text-xs text-green-600">Saved</span>
          )}
          {!role.isSystem && !deleteConfirm && (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="rounded p-1 text-neutral-300 hover:text-red-500 transition-colors"
              title="Delete role"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {deleteConfirm && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-neutral-500">Delete?</span>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="font-medium text-red-600 hover:underline disabled:opacity-60"
              >
                {deleting ? "…" : "Yes"}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="text-neutral-400 hover:underline"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {saveError && <p className="mb-2 text-xs text-red-600">{saveError}</p>}

      {/* Permissions */}
      <div className="min-h-[2.5rem]">
        {permissions.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">
            Drop permissions here
          </p>
        ) : (
          <div className="space-y-2">
            {Object.entries(groupPermissions(permissions))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([resource, perms]) => (
                <div key={resource} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-right text-xs font-medium text-neutral-400 capitalize">
                    {resource}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {perms.map((perm) => (
                      <DraggableChip
                        key={`${role.slug}:${perm}`}
                        id={`assigned:${role.slug}:${perm}`}
                        label={perm.split(":")[1]}
                        onRemove={() => onRemovePerm(perm)}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RolesTab() {
  const token = useAuthStore((s) => s.token);

  const [roleList, setRoleList] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [savedPermissions, setSavedPermissions] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string | null>>({});
  const [saveSuccess, setSaveSuccess] = useState<Record<string, boolean>>({});
  const successTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [addingRole, setAddingRole] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getRoles(token!), getRolePermissions(token!)])
      .then(([{ roles }, { roles: perms }]) => {
        setRoleList(roles);
        setPermissions(perms);
        setSavedPermissions(perms);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load."),
      )
      .finally(() => setLoading(false));
  }, [token]);

  // ── Drag ──────────────────────────────────────────────────────────────────

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("role:")) return;
    const targetSlug = overId.replace("role:", "");
    const activeId = String(active.id);

    let perm: string;
    if (activeId.startsWith("available:")) {
      perm = activeId.replace("available:", "");
    } else if (activeId.startsWith("assigned:")) {
      const parts = activeId.split(":");
      const sourceSlug = parts[1];
      perm = parts.slice(2).join(":");
      if (sourceSlug === targetSlug) return;
      setPermissions((prev) => ({
        ...prev,
        [sourceSlug]: prev[sourceSlug].filter((p) => p !== perm),
      }));
    } else return;

    setPermissions((prev) => {
      const existing = prev[targetSlug] ?? [];
      if (existing.includes(perm)) return prev;
      return { ...prev, [targetSlug]: [...existing, perm] };
    });
  }

  // ── Permission save ───────────────────────────────────────────────────────

  async function handleSave(slug: string) {
    setSaving((p) => ({ ...p, [slug]: true }));
    setSaveError((p) => ({ ...p, [slug]: null }));
    setSaveSuccess((p) => ({ ...p, [slug]: false }));
    try {
      const { permissions: saved } = await updateRolePermissions(
        token!,
        slug,
        permissions[slug] ?? [],
      );
      setSavedPermissions((p) => ({ ...p, [slug]: saved }));
      setSaveSuccess((p) => ({ ...p, [slug]: true }));
      if (successTimers.current[slug])
        clearTimeout(successTimers.current[slug]);
      successTimers.current[slug] = setTimeout(
        () => setSaveSuccess((p) => ({ ...p, [slug]: false })),
        3000,
      );
    } catch (err) {
      setSaveError((p) => ({
        ...p,
        [slug]: err instanceof ApiError ? err.message : "Save failed.",
      }));
    } finally {
      setSaving((p) => ({ ...p, [slug]: false }));
    }
  }

  // ── Role management ───────────────────────────────────────────────────────

  async function handleAddRole() {
    if (!newRoleLabel.trim()) return;
    setAddingRole(true);
    setAddError(null);
    try {
      const { role } = await createRole(token!, newRoleLabel.trim());
      setRoleList((prev) => [...prev, role]);
      setPermissions((prev) => ({ ...prev, [role.slug]: [] }));
      setSavedPermissions((prev) => ({ ...prev, [role.slug]: [] }));
      setNewRoleLabel("");
    } catch (err) {
      setAddError(
        err instanceof ApiError ? err.message : "Failed to create role.",
      );
    } finally {
      setAddingRole(false);
    }
  }

  async function handleRename(
    oldSlug: string,
    label: string,
    newSlug: string,
  ): Promise<string | null> {
    try {
      const { role: updated } = await renameRole(token!, oldSlug, {
        slug: newSlug,
        label,
      });
      setRoleList((prev) =>
        prev.map((r) => (r.slug === oldSlug ? updated : r)),
      );

      // If the slug changed, migrate local permission state to new key
      if (newSlug !== oldSlug) {
        setPermissions((prev) => {
          const updated = { ...prev, [newSlug]: prev[oldSlug] ?? [] };
          delete updated[oldSlug];
          return updated;
        });
        setSavedPermissions((prev) => {
          const updated = { ...prev, [newSlug]: prev[oldSlug] ?? [] };
          delete updated[oldSlug];
          return updated;
        });
      }
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : "Rename failed.";
    }
  }

  async function handleDelete(slug: string) {
    try {
      await deleteRole(token!, slug);
      setRoleList((prev) => prev.filter((r) => r.slug !== slug));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading)
    return <div className="text-sm text-neutral-500 py-6">Loading roles…</div>;
  if (error)
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );

  const activePermission = activeId
    ? activeId.startsWith("available:")
      ? activeId.replace("available:", "")
      : activeId.startsWith("assigned:")
        ? activeId.split(":").slice(2).join(":")
        : null
    : null;

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Left: role cards */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Header + add role */}
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-brand-dark">
              Roles & Permissions
            </h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              Drag permissions onto a role, click × to remove, then Save. Rename
              or delete custom roles with the inline controls.
            </p>

            {/* Add new role */}
            <div className="mt-4 flex items-center gap-2">
              <input
                value={newRoleLabel}
                onChange={(e) => {
                  setNewRoleLabel(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAddRole()}
                placeholder="New role name…"
                className="w-48 rounded-md border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
              />
              <button
                onClick={handleAddRole}
                disabled={addingRole || !newRoleLabel.trim()}
                className="flex items-center gap-1.5 rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {addingRole ? "Adding…" : "Add Role"}
              </button>
            </div>
            {addError && (
              <p className="mt-1.5 text-xs text-red-600">{addError}</p>
            )}
          </div>

          {roleList.map((role) => (
            <RoleCard
              key={role.slug}
              role={role}
              permissions={permissions[role.slug] ?? []}
              savedPermissions={savedPermissions[role.slug] ?? []}
              onRemovePerm={(perm) =>
                setPermissions((prev) => ({
                  ...prev,
                  [role.slug]: prev[role.slug].filter((p) => p !== perm),
                }))
              }
              onSave={() => handleSave(role.slug)}
              saving={saving[role.slug] ?? false}
              saveError={saveError[role.slug] ?? null}
              saveSuccess={saveSuccess[role.slug] ?? false}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {/* Right: permissions palette */}
        <div className="w-full lg:w-60 shrink-0">
          <div className="sticky top-24 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-brand-dark mb-1">
              All Permissions
            </h3>
            <p className="text-xs text-neutral-400 mb-4">
              Drag any permission onto a role card.
            </p>
            <div className="flex flex-col gap-1.5">
              {ALL_PERMISSIONS.map((perm) => (
                <DraggableChip
                  key={perm}
                  id={`available:${perm}`}
                  label={perm}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activePermission ? <StaticChip label={activePermission} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
