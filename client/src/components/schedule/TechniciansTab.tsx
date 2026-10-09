"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, getRoles, getUsers, RoleItem, UserListItem } from "@/lib/api";
import UsernameDisplay from "@/components/ui/UsernameDisplay";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { normalizeRoles, userHasCapability } from "@/lib/dashboard-role";
import { serviceTerritorySummary, weeklyHoursSummary } from "@/lib/schedule";

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

  function getRoleLabel(slug: string) {
    return roleList.find((r) => r.slug === slug)?.label ?? slug;
  }

  function formatUserRoles(user: UserListItem): string {
    return normalizeRoles(user).map(getRoleLabel).join(", ");
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
          hours, home location, and territory here.
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
                    label="Hours"
                    value={weeklyHoursSummary(user.weeklyHours)}
                  />
                  <DataField
                    label="Home"
                    value={user.homeLocation?.city || "—"}
                  />
                  <DataField
                    label="Territory"
                    value={serviceTerritorySummary(user.serviceCities)}
                  />
                </>
              }
              actions={
                <Link
                  href={`/dashboard/schedule/technician?id=${user._id}`}
                  className="inline-flex rounded-md p-1.5 text-brand-orange hover:bg-orange-50"
                  aria-label="Edit technician"
                >
                  <Pencil className="h-4 w-4" />
                </Link>
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
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Territory
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
                      <td className="px-6 py-4 text-neutral-600">
                        {weeklyHoursSummary(user.weeklyHours)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {user.homeLocation?.city || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {serviceTerritorySummary(user.serviceCities)}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <Link
                          href={`/dashboard/schedule/technician?id=${user._id}`}
                          className="inline-flex rounded-md p-1.5 text-brand-orange hover:bg-orange-50"
                          aria-label="Edit technician"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
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
