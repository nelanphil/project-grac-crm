"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getRoles,
  getUsers,
  RoleItem,
  updateUser,
  UserHomeLocation,
  UserListItem,
  UserWeeklyHours,
  validateCustomerAddress,
} from "@/lib/api";
import UsernameDisplay from "@/components/ui/UsernameDisplay";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import StaffWorkHoursForm from "@/components/schedule/StaffWorkHoursForm";
import {
  defaultWeeklyHours,
  emptyHomeLocation,
  weeklyHoursSummary,
} from "@/lib/schedule";

export default function TechniciansTab() {
  const token = useAuthStore((s) => s.token);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roleList, setRoleList] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<UserWeeklyHours>(
    defaultWeeklyHours(true),
  );
  const [home, setHome] = useState<UserHomeLocation>(emptyHomeLocation());
  const [homeValidating, setHomeValidating] = useState(false);
  const [homeMsg, setHomeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([getUsers(token), getRoles(token)])
      .then(([{ users: list }, { roles }]) => {
        setUsers(list);
        setRoleList(roles);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load technicians.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  const technicians = useMemo(
    () =>
      users.filter(
        (user) => user.schedulable && user.role !== "customer",
      ),
    [users],
  );

  function getRoleLabel(slug: string) {
    return roleList.find((r) => r.slug === slug)?.label ?? slug;
  }

  function openEdit(user: UserListItem) {
    setEditing(user);
    setWeeklyHours(user.weeklyHours ?? defaultWeeklyHours(true));
    setHome(user.homeLocation ?? emptyHomeLocation());
    setHomeMsg(null);
    setSaveError(null);
  }

  function closeEdit() {
    setEditing(null);
    setSaveError(null);
    setHomeMsg(null);
  }

  async function validateHome() {
    if (!token) return;
    const street = home.address.trim();
    if (!street) {
      setHomeMsg(null);
      setHome(emptyHomeLocation());
      return;
    }
    setHomeValidating(true);
    setHomeMsg(null);
    try {
      const result = await validateCustomerAddress(token, {
        address: street,
        city: home.city.trim(),
        state: home.state.trim(),
        zip: home.zip.trim(),
      });
      if (!result.valid || !result.address) {
        setHomeMsg(result.message || "Home address could not be validated.");
        return;
      }
      const matched = result.address;
      setHome({
        address: matched.address,
        city: matched.city,
        state: matched.state,
        zip: matched.zip,
        lat: result.coordinates?.lat ?? null,
        lng: result.coordinates?.lng ?? null,
      });
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { user } = await updateUser(token, editing._id, {
        weeklyHours,
        homeLocation: home,
      });
      setUsers((prev) => prev.map((u) => (u._id === user._id ? user : u)));
      closeEdit();
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save hours.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading technicians…</p>;
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-4 py-4 sm:px-6">
        <h2 className="text-lg font-semibold text-brand-dark">Technicians</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Staff with work schedule turned on. Toggle that under Users, then set
          hours and home location here.
        </p>
      </div>

      <div className="p-4 sm:p-0">
        <ResponsiveDataView
          isEmpty={technicians.length === 0}
          empty={
            <div className="px-4 py-10 text-center text-sm text-neutral-500 sm:px-6">
              No one is on a work schedule yet. Edit a staff user under Users
              and turn on work schedule.
            </div>
          }
          mobile={technicians.map((user) => (
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
                    label="Hours"
                    value={weeklyHoursSummary(user.weeklyHours)}
                  />
                  <DataField
                    label="Home"
                    value={user.homeLocation?.city || "—"}
                  />
                </>
              }
              actions={
                <button
                  type="button"
                  onClick={() => openEdit(user)}
                  className="text-xs font-medium text-brand-orange hover:underline"
                >
                  Edit hours
                </button>
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
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Hours
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Home
                    </th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white">
                  {technicians.map((user) => (
                    <tr key={user._id}>
                      <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                        {user.first_name} {user.last_name}
                        <div className="text-xs font-normal text-neutral-500">
                          <UsernameDisplay
                            username={user.username}
                            usernameNumber={user.usernameNumber}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-700 whitespace-nowrap">
                        {getRoleLabel(user.role)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {weeklyHoursSummary(user.weeklyHours)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {user.homeLocation?.city || "—"}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(user)}
                          className="text-xs font-medium text-brand-orange hover:underline"
                        >
                          Edit hours
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

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-3 py-3 sm:px-4 sm:py-6">
          <div className="flex w-full max-w-lg max-h-[min(92dvh,920px)] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="shrink-0 border-b border-neutral-100 px-4 py-4 sm:px-6">
              <h3 className="text-lg font-semibold text-brand-dark">
                {editing.first_name} {editing.last_name}
              </h3>
              <p className="mt-0.5 text-sm text-neutral-500">
                Weekly hours and home location for dispatch and routing.
              </p>
            </div>
            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 space-y-4"
            >
              {saveError && (
                <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {saveError}
                </div>
              )}
              <StaffWorkHoursForm
                weeklyHours={weeklyHours}
                home={home}
                onPatchWeekly={(day, patch) =>
                  setWeeklyHours((hours) => ({
                    ...hours,
                    [day]: { ...hours[day], ...patch },
                  }))
                }
                onChangeHome={(patch) =>
                  setHome((current) => ({ ...current, ...patch }))
                }
                onBlurHome={() => void validateHome()}
                homeValidating={homeValidating}
                homeMsg={homeMsg}
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
