"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { TextScheduleButton } from "@/components/schedule/TextScheduleDialog";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getRoles,
  getUsers,
  RoleItem,
  updateUser,
  UserListItem,
} from "@/lib/api";
import UsernameDisplay from "@/components/ui/UsernameDisplay";
import PhoneInput from "@/components/ui/PhoneInput";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { normalizeRoles, userHasCapability } from "@/lib/dashboard-role";
import { isValidUsPhone } from "@/lib/formatPhone";
import {
  formatLocalDate,
  resolvedTechnicianColor,
  serviceTerritorySummary,
  technicianColor,
  weeklyHoursSummary,
} from "@/lib/schedule";

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function phoneSaveError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.errors?.phone?.[0] || err.message;
  }
  return "Failed to save phone.";
}

function InlinePhoneEditor({
  userId,
  savedPhone,
  token,
  onSaved,
}: {
  userId: string;
  savedPhone: string;
  token: string | null;
  onSaved: (user: UserListItem) => void;
}) {
  const [value, setValue] = useState(savedPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipBlurSave = useRef(false);

  useEffect(() => {
    setValue(savedPhone);
  }, [savedPhone]);

  async function save(next: string) {
    if (!token || saving) return;
    const trimmed = next.trim();
    if (phoneDigits(trimmed) === phoneDigits(savedPhone)) {
      setValue(savedPhone);
      setError(null);
      return;
    }
    if (trimmed && !isValidUsPhone(trimmed)) {
      setError("Enter a 10-digit phone number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { user } = await updateUser(token, userId, { phone: trimmed });
      onSaved(user);
      setValue(user.phone ?? "");
    } catch (err) {
      setValue(savedPhone);
      setError(phoneSaveError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-[9.5rem]">
      <PhoneInput
        value={value}
        disabled={saving}
        aria-label="Phone"
        placeholder="Add phone"
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipBlurSave.current = true;
            setValue(savedPhone);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          if (skipBlurSave.current) {
            skipBlurSave.current = false;
            return;
          }
          void save(e.currentTarget.value);
        }}
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-neutral-700 outline-none placeholder:text-neutral-400 hover:border-neutral-200 focus:border-brand-orange focus:bg-[var(--staff-cream)] disabled:opacity-60"
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function ColorPicker({
  userId,
  savedColor,
  token,
  onSaved,
}: {
  userId: string;
  savedColor: string;
  token: string | null;
  onSaved: (user: UserListItem) => void;
}) {
  const [value, setValue] = useState(
    resolvedTechnicianColor(userId, savedColor),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    setValue(resolvedTechnicianColor(userId, savedColor));
  }, [savedColor, userId]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  async function save(next: string) {
    if (!token || saving) return;
    const saved = savedColor.trim().toLowerCase();
    if (saved && next.toLowerCase() === saved) return;
    if (!saved && next.toLowerCase() === technicianColor(userId)) return;
    const previous = resolvedTechnicianColor(userId, savedColor);
    setSaving(true);
    setError(null);
    try {
      const { user } = await updateUser(token, userId, { scheduleColor: next });
      onSaved(user);
      setValue(resolvedTechnicianColor(userId, user.scheduleColor));
    } catch (err) {
      setValue(previous);
      setError(err instanceof ApiError ? err.message : "Failed to save color.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <input
        type="color"
        aria-label="Schedule color"
        value={value}
        disabled={saving || !token}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => {
            void save(next);
          }, 400);
        }}
        className="h-7 w-9 cursor-pointer rounded border border-neutral-200 bg-transparent p-0.5 disabled:cursor-wait"
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export default function TechniciansTab() {
  const token = useAuthStore((s) => s.token);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roleList, setRoleList] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      users.filter((user) => userHasCapability(user, "schedulable")),
    [users],
  );
  const today = formatLocalDate(new Date());

  function getRoleLabel(slug: string) {
    return roleList.find((r) => r.slug === slug)?.label ?? slug;
  }

  function formatUserRoles(user: UserListItem): string {
    return normalizeRoles(user).map(getRoleLabel).join(", ");
  }

  function replaceUser(next: UserListItem) {
    setUsers((prev) => prev.map((user) => (user._id === next._id ? next : user)));
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
          Staff with the Technician role. Assign that role under Users, then set
          hours, contact, home location, and territory here.
        </p>
      </div>

      <div className="p-4 sm:p-0">
        <ResponsiveDataView
          isEmpty={technicians.length === 0}
          empty={
            <div className="px-4 py-10 text-center text-sm text-neutral-500 sm:px-6">
              No technicians yet. Assign the Technician role under Users.
            </div>
          }
          mobile={technicians.map((user) => (
            <MobileDataCard
              key={user._id}
              title={`${user.first_name} ${user.last_name}`}
              subtitle={user.email}
              badges={
                <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                  {formatUserRoles(user)}
                </span>
              }
              fields={
                <>
                  <DataField
                    label="Phone"
                    value={
                      <InlinePhoneEditor
                        userId={user._id}
                        savedPhone={user.phone ?? ""}
                        token={token}
                        onSaved={replaceUser}
                      />
                    }
                  />
                  <DataField
                    label="Hours"
                    value={weeklyHoursSummary(user.weeklyHours)}
                  />
                  <DataField
                    label="Home"
                    value={user.homeLocation?.city || "—"}
                  />
                  <DataField
                    label="Color"
                    value={
                      <ColorPicker
                        userId={user._id}
                        savedColor={user.scheduleColor ?? ""}
                        token={token}
                        onSaved={replaceUser}
                      />
                    }
                  />
                  <DataField
                    label="Territory"
                    value={serviceTerritorySummary(user.serviceCities)}
                  />
                </>
              }
              actions={
                <div className="flex items-center gap-1">
                  <TextScheduleButton
                    userId={user._id}
                    date={today}
                    variant="label"
                  />
                  <Link
                    href={`/dashboard/schedule/technician?id=${user._id}`}
                    className="inline-flex rounded-md p-1.5 text-brand-orange hover:bg-orange-50"
                    aria-label="Edit technician"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
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
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Hours
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Home
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Territory
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Color
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
                        {formatUserRoles(user)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <InlinePhoneEditor
                          userId={user._id}
                          savedPhone={user.phone ?? ""}
                          token={token}
                          onSaved={replaceUser}
                        />
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {weeklyHoursSummary(user.weeklyHours)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {user.homeLocation?.city || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {serviceTerritorySummary(user.serviceCities)}
                      </td>
                      <td className="px-6 py-4">
                        <ColorPicker
                          userId={user._id}
                          savedColor={user.scheduleColor ?? ""}
                          token={token}
                          onSaved={replaceUser}
                        />
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <TextScheduleButton
                            userId={user._id}
                            date={today}
                            variant="label"
                          />
                          <Link
                            href={`/dashboard/schedule/technician?id=${user._id}`}
                            className="inline-flex rounded-md p-1.5 text-brand-orange hover:bg-orange-50"
                            aria-label="Edit technician"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
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
    </div>
  );
}
