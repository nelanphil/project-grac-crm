"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { getUsers, updateUserRole, getRoles, UserListItem, RoleItem, ApiError } from "@/lib/api";

export default function UsersTab() {
  const token = useAuthStore((s) => s.token);
  const currentUser = useAuthStore((s) => s.user);

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roleList, setRoleList] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>("agent");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getUsers(token!), getRoles(token!)])
      .then(([{ users }, { roles }]) => {
        setUsers(users);
        setRoleList(roles);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load users."))
      .finally(() => setLoading(false));
  }, [token]);

  function getRoleLabel(slug: string) {
    return roleList.find((r) => r.slug === slug)?.label ?? slug;
  }

  async function handleSaveRole(id: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const { user: updated } = await updateUserRole(token!, id, editRole);
      setUsers((prev) => prev.map((u) => (u._id === id ? { ...u, role: updated.role } : u)));
      setEditingId(null);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to update role.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-neutral-500 py-6">Loading users…</div>;
  if (error) return <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-100">
        <h2 className="text-lg font-semibold text-brand-dark">Users</h2>
        <p className="text-sm text-neutral-500 mt-0.5">{users.length} total</p>
      </div>

      {saveError && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-100 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Name</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Email</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Role</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Joined</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {users.map((user) => (
              <tr key={user._id}>
                <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                  {user.first_name} {user.last_name}
                </td>
                <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">{user.email}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingId === user._id ? (
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-sm text-brand-dark outline-none focus:border-brand-orange"
                    >
                      {roleList.map((r) => (
                        <option key={r.slug} value={r.slug}>{r.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-neutral-700">{getRoleLabel(user.role)}</span>
                  )}
                </td>
                <td className="px-6 py-4 text-neutral-500 whitespace-nowrap">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-right whitespace-nowrap">
                  {currentUser?.id === user._id ? null : editingId === user._id ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleSaveRole(user._id)}
                        disabled={saving}
                        className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs font-medium text-neutral-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(user._id); setEditRole(user.role); setSaveError(null); }}
                      className="text-xs font-medium text-brand-orange hover:underline"
                    >
                      Edit Role
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
