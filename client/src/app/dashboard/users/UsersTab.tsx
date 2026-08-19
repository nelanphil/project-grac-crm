"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  validateCustomerAddress,
  UserListItem,
  RoleItem,
  ApiError,
  UserWeeklyHours,
  UserHomeLocation,
} from "@/lib/api";
import { FLORIDA_COUNTIES } from "@/lib/floridaCounties";
import UsernameDisplay from "@/components/ui/UsernameDisplay";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  defaultWeeklyHours,
  emptyHomeLocation,
} from "@/lib/schedule";

type ModalMode = "create" | "edit" | null;

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  username: "",
  role: "agent",
  password: "",
  counties: [] as string[],
  zips: [] as string[],
  schedulable: false,
  weeklyHours: defaultWeeklyHours(false),
  home: emptyHomeLocation(),
};

function normalizeZipInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

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
  const [zipDraft, setZipDraft] = useState("");
  const [homeValidating, setHomeValidating] = useState(false);
  const [homeMsg, setHomeMsg] = useState<string | null>(null);
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
    const role = roleList[0]?.slug ?? "agent";
    const schedulable = role === "tech";
    setForm({
      ...emptyForm,
      role,
      schedulable,
      weeklyHours: defaultWeeklyHours(schedulable),
      home: emptyHomeLocation(),
    });
    setZipDraft("");
    setHomeMsg(null);
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
      counties: user.territories?.counties ?? [],
      zips: user.territories?.zips ?? [],
      schedulable: user.schedulable ?? user.role === "tech",
      weeklyHours: user.weeklyHours ?? defaultWeeklyHours(Boolean(user.schedulable)),
      home: user.homeLocation ?? emptyHomeLocation(),
    });
    setZipDraft("");
    setHomeMsg(null);
    setEditingId(user._id);
    setSaveError(null);
    setTempPassword(null);
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setEditingId(null);
    setSaveError(null);
    setZipDraft("");
  }

  function toggleCounty(county: string) {
    setForm((f) => {
      const has = f.counties.includes(county);
      return {
        ...f,
        counties: has
          ? f.counties.filter((c) => c !== county)
          : [...f.counties, county].sort((a, b) => a.localeCompare(b)),
      };
    });
  }

  function addZip(raw: string) {
    const zip = normalizeZipInput(raw);
    if (zip.length !== 5) return;
    setForm((f) =>
      f.zips.includes(zip)
        ? f
        : { ...f, zips: [...f.zips, zip].sort() },
    );
    setZipDraft("");
  }

  function removeZip(zip: string) {
    setForm((f) => ({ ...f, zips: f.zips.filter((z) => z !== zip) }));
  }

  async function validateHome() {
    if (!token) return;
    const street = form.home.address.trim();
    if (!street) {
      setHomeMsg(null);
      setForm((f) => ({ ...f, home: emptyHomeLocation() }));
      return;
    }
    setHomeValidating(true);
    setHomeMsg(null);
    try {
      const result = await validateCustomerAddress(token, {
        address: street,
        city: form.home.city.trim(),
        state: form.home.state.trim(),
        zip: form.home.zip.trim(),
      });
      if (!result.valid || !result.address) {
        setHomeMsg(result.message || "Home address could not be validated.");
        return;
      }
      const matched = result.address;
      setForm((f) => ({
        ...f,
        home: {
          address: matched.address,
          city: matched.city,
          state: matched.state,
          zip: matched.zip,
          lat: result.coordinates?.lat ?? null,
          lng: result.coordinates?.lng ?? null,
        },
      }));
      setHomeMsg(
        result.coordinates
          ? "Home address verified."
          : "Address verified (no map coordinates).",
      );
    } catch (err) {
      setHomeMsg(
        err instanceof ApiError ? err.message : "Address validation failed.",
      );
    } finally {
      setHomeValidating(false);
    }
  }

  function patchWeekly(day: keyof UserWeeklyHours, patch: Partial<UserWeeklyHours[typeof day]>) {
    setForm((f) => ({
      ...f,
      weeklyHours: {
        ...f.weeklyHours,
        [day]: { ...f.weeklyHours[day], ...patch },
      },
    }));
  }

  function onZipKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (zipDraft.trim()) {
        e.preventDefault();
        addZip(zipDraft);
      }
    } else if (e.key === "Backspace" && !zipDraft && form.zips.length) {
      removeZip(form.zips[form.zips.length - 1]);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    setTempPassword(null);

    if (zipDraft.trim()) {
      addZip(zipDraft);
    }

    const territories =
      form.role === "owner"
        ? {
            counties: form.counties,
            zips: form.zips,
          }
        : undefined;

    try {
      if (modal === "create") {
        const payload: {
          email: string;
          first_name: string;
          last_name: string;
          role: string;
          password?: string;
          username?: string | null;
          territories?: { counties: string[]; zips: string[] };
          schedulable?: boolean;
          weeklyHours?: UserWeeklyHours;
          homeLocation?: UserHomeLocation;
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
        if (territories) payload.territories = territories;
        if (form.role !== "customer") {
          payload.schedulable = form.schedulable;
          payload.weeklyHours = form.weeklyHours;
          payload.homeLocation = form.home;
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
          territories?: { counties: string[]; zips: string[] };
          schedulable?: boolean;
          weeklyHours?: UserWeeklyHours;
          homeLocation?: UserHomeLocation;
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
        if (form.role === "owner") {
          payload.territories = {
            counties: form.counties,
            zips: form.zips,
          };
        } else {
          payload.territories = { counties: [], zips: [] };
        }
        if (form.role !== "customer") {
          payload.schedulable = form.schedulable;
          payload.weeklyHours = form.weeklyHours;
          payload.homeLocation = form.home;
        } else {
          payload.schedulable = false;
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
      <div className="px-4 py-4 sm:px-6 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-3">
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

      <div className="px-4 py-4 sm:px-6 border-b border-neutral-100 flex flex-col gap-3 sm:flex-row sm:items-center">
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
        <div className="mx-4 sm:mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError || deleteError}
        </div>
      )}

      <div className="p-4 sm:p-0">
        <ResponsiveDataView
          isEmpty={filteredUsers.length === 0}
          empty={
            <div className="px-2 py-8 text-center text-sm text-neutral-500 sm:px-6">
              No users match your search.
            </div>
          }
          mobile={filteredUsers.map((user) => (
            <MobileDataCard
              key={user._id}
              title={`${user.first_name} ${user.last_name}`}
              subtitle={user.email}
              badges={
                <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                  {getRoleLabel(user.role)}
                </span>
              }
              fields={
                <>
                  <DataField
                    label="Username"
                    value={
                      <UsernameDisplay
                        username={user.username}
                        usernameNumber={user.usernameNumber}
                      />
                    }
                  />
                  <DataField
                    label="Joined"
                    value={new Date(user.createdAt).toLocaleDateString()}
                  />
                </>
              }
              actions={
                <div className="flex flex-col items-end gap-2">
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
                  {filteredUsers.map((user) => (
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
                              {deletingId === user._id
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-3 py-3 sm:px-4 sm:py-6">
          <div
            className={`flex w-full max-h-[min(92dvh,920px)] flex-col overflow-hidden rounded-xl bg-white shadow-xl ${
              form.role === "owner" || form.role !== "customer"
                ? "max-w-2xl"
                : "max-w-md"
            }`}
          >
            <div className="shrink-0 border-b border-neutral-100 px-4 py-4 sm:px-6">
              <h3 className="text-lg font-semibold text-brand-dark">
                {modal === "create" ? "Create user" : "Edit user"}
              </h3>
            </div>

            {tempPassword ? (
              <div className="overflow-y-auto px-4 py-5 sm:px-6 space-y-4">
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
              <form
                onSubmit={handleSubmit}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 space-y-4"
              >
                {saveError && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {saveError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    onChange={(e) => {
                      const role = e.target.value;
                      const schedulable =
                        role === "customer" ? false : role === "tech";
                      setForm((f) => ({
                        ...f,
                        role,
                        schedulable,
                        weeklyHours: defaultWeeklyHours(schedulable),
                        ...(role !== "owner"
                          ? { counties: [], zips: [] }
                          : {}),
                      }));
                    }}
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  >
                    {roleList.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {form.role === "owner" && (
                  <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
                    <div>
                      <p className="text-sm font-medium text-brand-dark">
                        Territory (Florida)
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        Assign counties this owner covers. Use ZIP carve-outs
                        when two owners share a county.
                      </p>
                    </div>

                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <label className="block text-xs font-medium text-neutral-600">
                          Counties ({form.counties.length} selected)
                        </label>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                counties: [...FLORIDA_COUNTIES],
                              }))
                            }
                            className="text-xs font-medium text-brand-orange hover:underline"
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({ ...f, counties: [] }))
                            }
                            disabled={form.counties.length === 0}
                            className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
                        {FLORIDA_COUNTIES.map((county) => {
                          const checked = form.counties.includes(county);
                          return (
                            <label
                              key={county}
                              className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCounty(county)}
                                className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                              />
                              {county}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                        ZIP carve-outs
                      </label>
                      <div className="flex flex-wrap gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-2 min-h-[42px]">
                        {form.zips.map((zip) => (
                          <button
                            key={zip}
                            type="button"
                            onClick={() => removeZip(zip)}
                            className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
                          >
                            {zip}
                            <span aria-hidden>×</span>
                          </button>
                        ))}
                        <input
                          type="text"
                          inputMode="numeric"
                          value={zipDraft}
                          onChange={(e) =>
                            setZipDraft(normalizeZipInput(e.target.value))
                          }
                          onKeyDown={onZipKeyDown}
                          onBlur={() => {
                            if (zipDraft.length === 5) addZip(zipDraft);
                          }}
                          placeholder={
                            form.zips.length ? "Add ZIP…" : "e.g. 32789"
                          }
                          className="min-w-[5rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
                        />
                      </div>
                      <p className="mt-1 text-xs text-neutral-400">
                        Press Enter to add. ZIP claims override county
                        ownership.
                      </p>
                    </div>
                  </div>
                )}

                {form.role !== "customer" && (
                  <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
                    <div>
                      <p className="text-sm font-medium text-brand-dark">
                        Schedule
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        Availability and home location for dispatch and routing.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={form.schedulable}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            schedulable: e.target.checked,
                          }))
                        }
                        className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                      />
                      Appear on the schedule board
                    </label>

                    {form.schedulable && (
                      <>
                        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
                          <table className="min-w-full text-xs">
                            <thead className="bg-neutral-50 text-neutral-500">
                              <tr>
                                <th className="px-2 py-1.5 text-left font-medium">
                                  Day
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium">
                                  On
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium">
                                  Start
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium">
                                  End
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {WEEKDAY_KEYS.map((key) => {
                                const day = form.weeklyHours[key];
                                return (
                                  <tr
                                    key={key}
                                    className="border-t border-neutral-100"
                                  >
                                    <td className="px-2 py-1.5 text-neutral-700">
                                      {WEEKDAY_LABELS[key]}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="checkbox"
                                        checked={day.enabled}
                                        onChange={(e) =>
                                          patchWeekly(key, {
                                            enabled: e.target.checked,
                                          })
                                        }
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="time"
                                        value={day.start}
                                        disabled={!day.enabled}
                                        onChange={(e) =>
                                          patchWeekly(key, {
                                            start: e.target.value,
                                          })
                                        }
                                        className="rounded border border-neutral-200 px-1 py-0.5 disabled:opacity-40"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="time"
                                        value={day.end}
                                        disabled={!day.enabled}
                                        onChange={(e) =>
                                          patchWeekly(key, {
                                            end: e.target.value,
                                          })
                                        }
                                        className="rounded border border-neutral-200 px-1 py-0.5 disabled:opacity-40"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-medium text-neutral-600">
                            Home location
                          </p>
                          <input
                            value={form.home.address}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                home: { ...f.home, address: e.target.value },
                              }))
                            }
                            onBlur={() => void validateHome()}
                            placeholder="Street address"
                            className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                          />
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            <input
                              value={form.home.city}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  home: { ...f.home, city: e.target.value },
                                }))
                              }
                              onBlur={() => void validateHome()}
                              placeholder="City"
                              className="rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                            />
                            <input
                              value={form.home.state}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  home: { ...f.home, state: e.target.value },
                                }))
                              }
                              onBlur={() => void validateHome()}
                              placeholder="State"
                              className="rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                            />
                            <input
                              value={form.home.zip}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  home: { ...f.home, zip: e.target.value },
                                }))
                              }
                              onBlur={() => void validateHome()}
                              placeholder="ZIP"
                              className="col-span-2 rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange sm:col-span-1"
                            />
                          </div>
                          {homeValidating && (
                            <p className="text-xs text-neutral-400">
                              Validating address…
                            </p>
                          )}
                          {homeMsg && (
                            <p className="text-xs text-neutral-500">{homeMsg}</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

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
