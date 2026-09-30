"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  getJobRoles,
  UserListItem,
  RoleItem,
  JobRoleItem,
  ApiError,
} from "@/lib/api";
import JobRoleFieldsRenderer from "@/components/users/JobRoleFieldsRenderer";
import { FLORIDA_COUNTIES } from "@/lib/floridaCounties";
import UsernameDisplay from "@/components/ui/UsernameDisplay";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  defaultWeeklyHours,
  weeklyHoursNeverEnabled,
} from "@/lib/schedule";
import { DEFAULT_PAGE_SIZE, type PageSize } from "@/lib/pagination";
import {
  hasJobRoleCapability,
  isCustomerRole,
  isSuperAdminRole,
  normalizeRoles,
} from "@/lib/dashboard-role";

type ModalMode = "create" | "edit" | null;
type UserView = "staff" | "customers";

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  username: "",
  userType: "staff" as "staff" | "customer",
  roles: ["agent"] as string[],
  jobRoles: [] as string[],
  jobRoleData: {} as Record<string, Record<string, unknown>>,
  password: "",
  counties: [] as string[],
  zips: [] as string[],
  weeklyHours: defaultWeeklyHours(false),
};

function normalizeZipInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

export default function UsersTab() {
  const token = useAuthStore((s) => s.token);
  const currentUser = useAuthStore((s) => s.user);
  const isSuperAdmin = isSuperAdminRole(currentUser);

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roleList, setRoleList] = useState<RoleItem[]>([]);
  const [jobRoleList, setJobRoleList] = useState<JobRoleItem[]>([]);
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
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    Promise.all([getUsers(token!), getRoles(token!), getJobRoles(token!)])
      .then(([{ users }, { roles }, { jobRoles }]) => {
        setUsers(users);
        setRoleList(roles);
        setJobRoleList(jobRoles);
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

  function formatUserRoles(user: UserListItem): string {
    return normalizeRoles(user).map(getRoleLabel).join(", ");
  }

  function jobRoleLabels(user: UserListItem): string[] {
    return (user.jobRoles ?? [])
      .map((id) => jobRoleList.find((role) => role._id === id)?.label)
      .filter((label): label is string => Boolean(label));
  }

  const staffRoles = useMemo(
    () => roleList.filter((r) => r.slug !== "customer" && r.slug !== "tech" && r.slug !== "owner"),
    [roleList],
  );

  const selectedJobRoles = useMemo(
    () => jobRoleList.filter((role) => form.jobRoles.includes(role._id)),
    [jobRoleList, form.jobRoles],
  );
  const formSchedulable = selectedJobRoles.some(
    (role) => role.capabilities.schedulable,
  );
  const formTerritory = selectedJobRoles.some(
    (role) => role.capabilities.territoryOwner,
  );

  const staffUsers = useMemo(
    () => users.filter((user) => !isCustomerRole(user)),
    [users],
  );

  const customerUsers = useMemo(
    () => users.filter((user) => isCustomerRole(user)),
    [users],
  );

  const visibleUsers = view === "staff" ? staffUsers : customerUsers;
  const isCustomerView = view === "customers";
  const isCustomerForm = form.userType === "customer";

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleUsers.filter((user) => {
      if (
        view === "staff" &&
        roleFilter !== "all" &&
        !normalizeRoles(user).includes(roleFilter)
      ) {
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
    const customer = view === "customers";
    setForm({
      ...emptyForm,
      userType: customer ? "customer" : "staff",
      roles: customer ? ["customer"] : [staffRoles[0]?.slug ?? "agent"],
      weeklyHours: defaultWeeklyHours(false),
    });
    setZipDraft("");
    setEditingId(null);
    setSaveError(null);
    setTempPassword(null);
    setModal("create");
  }

  function openEdit(user: UserListItem) {
    const customer = user.userType === "customer" || isCustomerRole(user);
    setForm({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      username: user.username ?? "",
      userType: customer ? "customer" : "staff",
      roles: customer ? ["customer"] : normalizeRoles(user),
      jobRoles: customer ? [] : (user.jobRoles ?? []),
      jobRoleData: customer ? {} : (user.jobRoleData ?? {}),
      password: "",
      counties: user.territories?.counties ?? [],
      zips: user.territories?.zips ?? [],
      weeklyHours:
        user.weeklyHours ??
        defaultWeeklyHours(
          hasJobRoleCapability(user.jobRoles, jobRoleList, "schedulable") ||
            Boolean(user.schedulable),
        ),
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

  function toggleFormRole(slug: string) {
    setForm((f) => {
      const has = f.roles.includes(slug);
      let roles = has
        ? f.roles.filter((role) => role !== slug)
        : [...f.roles, slug];
      if (roles.length === 0) {
        roles = [staffRoles[0]?.slug ?? "agent"];
      }
      return { ...f, roles };
    });
  }

  function setAccountType(next: "staff" | "customer") {
    setForm((f) => {
      if (next === "customer") {
        return {
          ...f,
          userType: "customer",
          roles: ["customer"],
          jobRoles: [],
          jobRoleData: {},
          counties: [],
          zips: [],
        };
      }
      return {
        ...f,
        userType: "staff",
        roles:
          f.userType === "customer"
            ? [staffRoles[0]?.slug ?? "agent"]
            : f.roles,
      };
    });
  }

  function toggleJobRole(id: string) {
    setForm((f) => {
      const has = f.jobRoles.includes(id);
      const jobRoles = has
        ? f.jobRoles.filter((roleId) => roleId !== id)
        : [...f.jobRoles, id];
      const role = jobRoleList.find((item) => item._id === id);
      const stillTerritory = jobRoleList.some(
        (item) =>
          jobRoles.includes(item._id) && item.capabilities.territoryOwner,
      );
      return {
        ...f,
        jobRoles,
        weeklyHours:
          !has &&
          role?.capabilities.schedulable &&
          weeklyHoursNeverEnabled(f.weeklyHours)
            ? defaultWeeklyHours(true)
            : f.weeklyHours,
        ...(has && !stillTerritory
          ? { counties: [] as string[], zips: [] as string[] }
          : {}),
      };
    });
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

    const customer = form.userType === "customer";
    const shared = {
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      userType: form.userType,
      roles: customer ? ["customer"] : form.roles,
      jobRoles: customer ? [] : form.jobRoles,
      jobRoleData: customer ? {} : form.jobRoleData,
      username: form.username.trim() === "" ? null : form.username.trim(),
      territories: customer || !formTerritory
        ? { counties: [] as string[], zips: [] as string[] }
        : { counties: form.counties, zips: form.zips },
      ...(formSchedulable && !customer
        ? {
            weeklyHours: weeklyHoursNeverEnabled(form.weeklyHours)
              ? defaultWeeklyHours(true)
              : form.weeklyHours,
          }
        : {}),
    };

    try {
      if (modal === "create") {
        const payload: typeof shared & { password?: string } = { ...shared };
        if (form.password.trim()) payload.password = form.password;
        const { user, temporaryPassword } = await createUser(token, payload);
        setUsers((prev) => [
          user,
          ...prev.filter((row) => row._id !== user._id),
        ]);
        if (isCustomerRole(user) && view !== "customers") {
          setUserView("customers");
        } else if (!isCustomerRole(user) && view === "customers") {
          setUserView("staff");
        }
        if (temporaryPassword) {
          setTempPassword(temporaryPassword);
        } else {
          closeModal();
        }
      } else if (modal === "edit" && editingId) {
        const payload: typeof shared & { password?: string } = { ...shared };
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

      <TablePagination {...paginationProps} position="top" />

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
                  <span className="inline-flex flex-wrap gap-1">
                    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      {formatUserRoles(user)}
                    </span>
                    {jobRoleLabels(user).map((label) => (
                      <span
                        key={label}
                        className="inline-flex rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-brand-orange"
                      >
                        {label}
                      </span>
                    ))}
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
                        Roles
                      </th>
                    )}
                    {!isCustomerView && (
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Job roles
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
                        <td className="px-6 py-4 text-neutral-700">
                          {formatUserRoles(user)}
                        </td>
                      )}
                      {!isCustomerView && (
                        <td className="px-6 py-4 text-neutral-700">
                          {jobRoleLabels(user).length
                            ? jobRoleLabels(user).join(", ")
                            : "—"}
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
        <TablePagination {...paginationProps} position="bottom" />
      ) : null}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-3 py-3 sm:px-4 sm:py-6">
          <div
            className={`flex w-full max-h-[min(92dvh,920px)] flex-col overflow-hidden rounded-xl bg-white shadow-xl ${
              formTerritory || selectedJobRoles.some((role) => role.fields.length > 0)
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
                    Account type
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["staff", "customer"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setAccountType(type)}
                        className={`rounded-md border px-3 py-2 text-sm font-medium capitalize ${
                          form.userType === type
                            ? "border-brand-orange bg-orange-50 text-brand-dark"
                            : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {isCustomerForm
                      ? "Customers sign in to the portal. They use the customer security role."
                      : "Staff use security roles for access and job roles for scheduling and territories."}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    {isCustomerForm ? "Security role" : "Security roles"}
                  </label>
                  {isCustomerForm ? (
                    <input
                      readOnly
                      value={getRoleLabel("customer")}
                      className="mt-1 block w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
                    />
                  ) : (
                    <div className="mt-2 space-y-2 rounded-md border border-neutral-200 bg-white p-3">
                      {staffRoles.map((r) => {
                        const checked = form.roles.includes(r.slug);
                        const onlyRole =
                          checked && form.roles.length === 1;
                        return (
                          <label
                            key={r.slug}
                            className="flex items-start gap-2 text-sm text-neutral-700"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={onlyRole}
                              onChange={() => toggleFormRole(r.slug)}
                              className="mt-0.5 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                            />
                            <span className="font-medium">{r.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {!isCustomerForm && (
                  <div>
                    <label className="block text-sm font-medium text-brand-dark">
                      Job roles
                    </label>
                    <div className="mt-2 space-y-2 rounded-md border border-neutral-200 bg-white p-3">
                      {jobRoleList.length === 0 ? (
                        <p className="text-sm text-neutral-500">No job roles yet.</p>
                      ) : (
                        jobRoleList.map((role) => (
                          <label
                            key={role._id}
                            className="flex items-start gap-2 text-sm text-neutral-700"
                          >
                            <input
                              type="checkbox"
                              checked={form.jobRoles.includes(role._id)}
                              onChange={() => toggleJobRole(role._id)}
                              className="mt-0.5 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                            />
                            <span>
                              <span className="font-medium">{role.label}</span>
                              <span className="mt-0.5 block text-xs text-neutral-500">
                                {[
                                  role.capabilities.schedulable
                                    ? "Can be scheduled"
                                    : null,
                                  role.capabilities.territoryOwner
                                    ? "Owns a territory"
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || role.description || "No capabilities"}
                              </span>
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {!isCustomerForm &&
                  selectedJobRoles.map((role) => (
                    <JobRoleFieldsRenderer
                      key={role._id}
                      title={role.label}
                      color={role.color}
                      fields={role.fields}
                      values={form.jobRoleData[role._id] ?? {}}
                      onChange={(key, value) =>
                        setForm((f) => ({
                          ...f,
                          jobRoleData: {
                            ...f.jobRoleData,
                            [role._id]: {
                              ...(f.jobRoleData[role._id] ?? {}),
                              [key]: value,
                            },
                          },
                        }))
                      }
                    />
                  ))}

                {formSchedulable && !isCustomerForm && (
                  <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
                    <p className="text-sm font-medium text-brand-dark">
                      Weekly hours
                    </p>
                    <p className="text-xs text-neutral-500">
                      Shown on the schedule because a selected job role is schedulable.
                    </p>
                    <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
                      <table className="min-w-full text-xs">
                        <thead className="bg-neutral-50 text-neutral-500">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium">Day</th>
                            <th className="px-2 py-1.5 text-left font-medium">On</th>
                            <th className="px-2 py-1.5 text-left font-medium">Start</th>
                            <th className="px-2 py-1.5 text-left font-medium">End</th>
                          </tr>
                        </thead>
                        <tbody>
                          {WEEKDAY_KEYS.map((day) => (
                            <tr key={day} className="border-t border-neutral-100">
                              <td className="px-2 py-1.5">{WEEKDAY_LABELS[day]}</td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={form.weeklyHours[day].enabled}
                                  onChange={(e) =>
                                    setForm((f) => ({
                                      ...f,
                                      weeklyHours: {
                                        ...f.weeklyHours,
                                        [day]: {
                                          ...f.weeklyHours[day],
                                          enabled: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="time"
                                  value={form.weeklyHours[day].start}
                                  onChange={(e) =>
                                    setForm((f) => ({
                                      ...f,
                                      weeklyHours: {
                                        ...f.weeklyHours,
                                        [day]: {
                                          ...f.weeklyHours[day],
                                          start: e.target.value,
                                        },
                                      },
                                    }))
                                  }
                                  className="rounded border border-neutral-200 px-1 py-0.5"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="time"
                                  value={form.weeklyHours[day].end}
                                  onChange={(e) =>
                                    setForm((f) => ({
                                      ...f,
                                      weeklyHours: {
                                        ...f.weeklyHours,
                                        [day]: {
                                          ...f.weeklyHours[day],
                                          end: e.target.value,
                                        },
                                      },
                                    }))
                                  }
                                  className="rounded border border-neutral-200 px-1 py-0.5"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {formTerritory && !isCustomerForm && (
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
