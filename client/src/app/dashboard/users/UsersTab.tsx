"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
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
  UserWeeklyHours,
} from "@/lib/api";
import { FLORIDA_COUNTIES } from "@/lib/floridaCounties";
import UsernameDisplay from "@/components/ui/UsernameDisplay";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { defaultWeeklyHours, weeklyHoursNeverEnabled } from "@/lib/schedule";

type ModalMode = "create" | "edit" | null;
type UserView = "staff" | "customers";

const PAGE_SIZE_OPTIONS = [25, 50, 150, 250, 500] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

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
};

function normalizeZipInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

function UsersPagination({
  rangeStart,
  rangeEnd,
  total,
  pageSize,
  safePage,
  totalPages,
  onPageSizeChange,
  onPrev,
  onNext,
  position,
}: {
  rangeStart: number;
  rangeEnd: number;
  total: number;
  pageSize: PageSize;
  safePage: number;
  totalPages: number;
  onPageSizeChange: (size: PageSize) => void;
  onPrev: () => void;
  onNext: () => void;
  position: "top" | "bottom";
}) {
  return (
    <div
      className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${
        position === "top"
          ? "border-b border-neutral-100"
          : "border-t border-neutral-100"
      }`}
    >
      <p className="text-xs text-neutral-500">
        Showing {rangeStart}&ndash;{rangeEnd} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Rows
          <select
            value={pageSize}
            onChange={(e) =>
              onPageSizeChange(Number(e.target.value) as PageSize)
            }
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-brand-dark outline-none focus:border-brand-orange"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={onPrev}
            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-brand-dark transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-2 text-xs text-neutral-500">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={onNext}
            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-brand-dark transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [view, setView] = useState<UserView>("staff");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

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

  const staffRoles = useMemo(
    () => roleList.filter((r) => r.slug !== "customer"),
    [roleList],
  );

  const staffUsers = useMemo(
    () => users.filter((user) => user.role !== "customer"),
    [users],
  );

  const customerUsers = useMemo(
    () => users.filter((user) => user.role === "customer"),
    [users],
  );

  const visibleUsers = view === "staff" ? staffUsers : customerUsers;
  const isCustomerView = view === "customers";
  const isCustomerForm = form.role === "customer";

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleUsers.filter((user) => {
      if (view === "staff" && roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }
      if (!q) return true;
      const haystack =
        `${user.first_name} ${user.last_name} ${user.email} ${user.username ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [visibleUsers, search, roleFilter, view]);

  const total = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);
  const pagedUsers = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, safePage, pageSize]);

  const paginationProps = {
    rangeStart,
    rangeEnd,
    total,
    pageSize,
    safePage,
    totalPages,
    onPageSizeChange: (size: PageSize) => {
      setPageSize(size);
      setPage(1);
    },
    onPrev: () => setPage((p) => Math.max(1, p - 1)),
    onNext: () => setPage((p) => Math.min(totalPages, p + 1)),
  };

  function setUserView(next: UserView) {
    setView(next);
    setRoleFilter("all");
    setPage(1);
  }

  function openCreate() {
    const role = staffRoles[0]?.slug ?? "agent";
    const schedulable = role === "tech";
    setForm({
      ...emptyForm,
      role,
      schedulable,
      weeklyHours: defaultWeeklyHours(schedulable),
    });
    setZipDraft("");
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
      schedulable:
        user.role === "customer"
          ? false
          : (user.schedulable ?? user.role === "tech"),
      weeklyHours: user.weeklyHours ?? defaultWeeklyHours(Boolean(user.schedulable)),
    });
    setZipDraft("");
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
        payload.schedulable = form.schedulable;
        if (form.schedulable) {
          payload.weeklyHours = weeklyHoursNeverEnabled(form.weeklyHours)
            ? defaultWeeklyHours(true)
            : form.weeklyHours;
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
        if (form.role === "customer") {
          payload.schedulable = false;
          payload.territories = { counties: [], zips: [] };
        } else {
          if (form.role === "owner") {
            payload.territories = {
              counties: form.counties,
              zips: form.zips,
            };
          } else {
            payload.territories = { counties: [], zips: [] };
          }
          payload.schedulable = form.schedulable;
          if (form.schedulable) {
            payload.weeklyHours = weeklyHoursNeverEnabled(form.weeklyHours)
              ? defaultWeeklyHours(true)
              : form.weeklyHours;
          }
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
            {filteredUsers.length === visibleUsers.length
              ? `${visibleUsers.length} ${view === "staff" ? "staff" : "customers"}`
              : `${filteredUsers.length} of ${visibleUsers.length}`}
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
        <div className="inline-flex shrink-0 rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setUserView("staff")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === "staff"
                ? "bg-brand-dark text-white"
                : "text-neutral-600 hover:text-brand-dark"
            }`}
          >
            Staff
          </button>
          <button
            type="button"
            onClick={() => setUserView("customers")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === "customers"
                ? "bg-brand-dark text-white"
                : "text-neutral-600 hover:text-brand-dark"
            }`}
          >
            Customers
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name, email, or username…"
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange sm:max-w-xs"
        />
        {view === "staff" && (
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange sm:w-auto"
          >
            <option value="all">All roles</option>
            {staffRoles.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {(saveError || deleteError) && !modal && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError || deleteError}
        </div>
      )}

      {total > 0 ? <UsersPagination {...paginationProps} position="top" /> : null}

      <div className="p-4 sm:p-0">
        <ResponsiveDataView
          isEmpty={filteredUsers.length === 0}
          empty={
            <div className="px-2 py-8 text-center text-sm text-neutral-500 sm:px-6">
              No users match your search.
            </div>
          }
          mobile={pagedUsers.map((user) => (
            <MobileDataCard
              key={user._id}
              title={`${user.first_name} ${user.last_name}`}
              subtitle={user.email}
              badges={
                isCustomerView ? undefined : (
                  <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                    {getRoleLabel(user.role)}
                  </span>
                )
              }
              fields={
                <>
                  {!isCustomerView && (
                    <DataField
                      label="Username"
                      value={
                        <UsernameDisplay
                          username={user.username}
                          usernameNumber={user.usernameNumber}
                        />
                      }
                    />
                  )}
                  {!isCustomerView && (
                    <DataField
                      label="Work schedule"
                      value={user.schedulable ? "On" : "Off"}
                    />
                  )}
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
                    {!isCustomerView && (
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Username
                      </th>
                    )}
                    {!isCustomerView && (
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Role
                      </th>
                    )}
                    {!isCustomerView && (
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Work schedule
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Joined
                    </th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white">
                  {pagedUsers.map((user) => (
                    <tr key={user._id}>
                      <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                        {user.first_name} {user.last_name}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {user.email}
                      </td>
                      {!isCustomerView && (
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          <UsernameDisplay
                            username={user.username}
                            usernameNumber={user.usernameNumber}
                          />
                        </td>
                      )}
                      {!isCustomerView && (
                        <td className="px-6 py-4 text-neutral-700 whitespace-nowrap">
                          {getRoleLabel(user.role)}
                        </td>
                      )}
                      {!isCustomerView && (
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {user.schedulable ? "On" : "Off"}
                        </td>
                      )}
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

      {total > 0 ? (
        <UsersPagination {...paginationProps} position="bottom" />
      ) : null}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-3 py-3 sm:px-4 sm:py-6">
          <div
            className={`flex w-full max-h-[min(92dvh,920px)] flex-col overflow-hidden rounded-xl bg-white shadow-xl ${
              form.role === "owner" ? "max-w-2xl" : "max-w-md"
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
                  {isCustomerForm ? (
                    <input
                      readOnly
                      value={getRoleLabel("customer")}
                      className="mt-1 block w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
                    />
                  ) : (
                    <select
                      value={form.role}
                      onChange={(e) => {
                        const role = e.target.value;
                        setForm((f) => ({
                          ...f,
                          role,
                          ...(role !== "owner"
                            ? { counties: [], zips: [] }
                            : {}),
                        }));
                      }}
                      className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                    >
                      {staffRoles.map((r) => (
                        <option key={r.slug} value={r.slug}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
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

                {!isCustomerForm && (
                  <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
                    <div>
                      <p className="text-sm font-medium text-brand-dark">
                        Work schedule
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        When on, this user appears as a technician on the Schedule
                        page. Set weekly hours and home location there.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={form.schedulable}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm((f) => ({
                            ...f,
                            schedulable: checked,
                            weeklyHours:
                              checked && weeklyHoursNeverEnabled(f.weeklyHours)
                                ? defaultWeeklyHours(true)
                                : f.weeklyHours,
                          }));
                        }}
                        className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                      />
                      On work schedule
                    </label>
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
