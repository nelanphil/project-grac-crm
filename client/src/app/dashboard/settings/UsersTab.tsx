"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  UserListItem,
  RoleItem,
  ApiError,
} from "@/lib/api";
import UsernameDisplay from "@/components/ui/UsernameDisplay";

type ModalMode = "create" | "edit" | null;

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  username: "",
  role: "agent",
  password: "",
};

export default function UsersTab() {
  const token = useAuthStore((s) => s.token);
  const currentUser = useAuthStore((s) => s.user);
  const isSuperAdmin = currentUser?.role === "super-admin";

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roleList, setRoleList] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  useEffect(() => {
    Promise.all([getUsers(token!), getRoles(token!)])
      .then(([{ users }, { roles }]) => {
        setUsers(users);
        setRoleList(roles);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load users.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function getRoleLabel(slug: string) {
    return roleList.find((r) => r.slug === slug)?.label ?? slug;
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!q) return true;
      const haystack =
        `${user.first_name} ${user.last_name} ${user.email} ${user.username ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [users, search, roleFilter]);

  function openCreate() {
    setForm({ ...emptyForm, role: roleList[0]?.slug ?? "agent" });
    setEditingId(null);
    setSaveError(null);
    setTempPassword(null);
    setModal("create");
  }

  function openEdit(user: UserListItem) {
    setForm({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      username: user.username ?? "",
      role: user.role,
      password: "",
    });
    setEditingId(user._id);
    setSaveError(null);
    setTempPassword(null);
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setEditingId(null);
    setSaveError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    setTempPassword(null);

    try {
      if (modal === "create") {
        const payload: {
          email: string;
          first_name: string;
          last_name: string;
          role: string;
          password?: string;
          username?: string | null;
        } = {
          email: form.email.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          role: form.role,
          username: form.username.trim() === "" ? null : form.username.trim(),
        };
        if (form.password.trim()) {
          payload.password = form.password;
        }
        const { user, temporaryPassword } = await createUser(token, payload);
        setUsers((prev) => [user, ...prev]);
        if (temporaryPassword) {
          setTempPassword(temporaryPassword);
        } else {
          closeModal();
        }
      } else if (modal === "edit" && editingId) {
        const payload: {
          email: string;
          first_name: string;
          last_name: string;
          role: string;
          username: string | null;
          password?: string;
        } = {
          email: form.email.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          role: form.role,
          username: form.username.trim() === "" ? null : form.username.trim(),
        };
        if (isSuperAdmin && form.password.trim()) {
          payload.password = form.password;
        }
        const { user } = await updateUser(token, editingId, payload);
        setUsers((prev) => prev.map((u) => (u._id === editingId ? user : u)));
        closeModal();
      }
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save user.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (
      !window.confirm(
        "Soft-delete this user? They will no longer be able to sign in.",
      )
    ) {
      return;
    }
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteUser(token, id);
      setUsers((prev) => prev.filter((u) => u._id !== id));
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to delete user.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-6">Loading users…</div>;
  }
  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">Users</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            {filteredUsers.length === users.length
              ? `${users.length} total`
              : `${filteredUsers.length} of ${users.length}`}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary text-sm px-4 py-2"
        >
          Create user
        </button>
      </div>

      <div className="px-6 py-4 border-b border-neutral-100 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or username…"
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange sm:max-w-xs"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange sm:w-auto"
        >
          <option value="all">All roles</option>
          {roleList.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {(saveError || deleteError) && !modal && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError || deleteError}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-100 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Username
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Joined
              </th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-8 text-center text-sm text-neutral-500"
                >
                  No users match your search.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user._id}>
                  <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                    {user.first_name} {user.last_name}
                  </td>
                  <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                    {user.email}
                  </td>
                  <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                    <UsernameDisplay
                      username={user.username}
                      usernameNumber={user.usernameNumber}
                    />
                  </td>
                  <td className="px-6 py-4 text-neutral-700 whitespace-nowrap">
                    {getRoleLabel(user.role)}
                  </td>
                  <td className="px-6 py-4 text-neutral-500 whitespace-nowrap">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="text-xs font-medium text-brand-orange hover:underline"
                      >
                        Edit
                      </button>
                      {currentUser?.id !== user._id && (
                        <button
                          type="button"
                          onClick={() => handleDelete(user._id)}
                          disabled={deletingId === user._id}
                          className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
                        >
                          {deletingId === user._id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="border-b border-neutral-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-brand-dark">
                {modal === "create" ? "Create user" : "Edit user"}
              </h3>
            </div>

            {tempPassword ? (
              <div className="px-6 py-5 space-y-4">
                <p className="text-sm text-neutral-700">
                  User created. A temporary password was generated — copy it
                  now. The user can set a new password via Forgot password.
                </p>
                <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 font-mono text-sm break-all">
                  {tempPassword}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="btn-primary text-sm px-4 py-2"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                {saveError && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {saveError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-brand-dark">
                      First name
                    </label>
                    <input
                      required
                      value={form.first_name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, first_name: e.target.value }))
                      }
                      className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-brand-dark">
                      Last name
                    </label>
                    <input
                      required
                      value={form.last_name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, last_name: e.target.value }))
                      }
                      className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Username{" "}
                    <span className="font-normal text-neutral-500">
                      (optional)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, username: e.target.value }))
                    }
                    pattern="[a-zA-Z][a-zA-Z0-9_]{2,29}"
                    title="3–30 characters, start with a letter, letters/numbers/underscores only"
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                    placeholder="e.g. doc"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Role
                  </label>
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, role: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  >
                    {roleList.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {(modal === "create" || (modal === "edit" && isSuperAdmin)) && (
                  <div>
                    <label className="block text-sm font-medium text-brand-dark">
                      Password{" "}
                      <span className="font-normal text-neutral-500">
                        {modal === "create"
                          ? "(optional — leave blank to auto-generate)"
                          : "(optional — leave blank to keep current)"}
                      </span>
                    </label>
                    <input
                      type="password"
                      minLength={8}
                      value={form.password}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, password: e.target.value }))
                      }
                      className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                      placeholder="Min 8 characters"
                      autoComplete="new-password"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
                  >
                    {saving
                      ? "Saving…"
                      : modal === "create"
                        ? "Create"
                        : "Save"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
