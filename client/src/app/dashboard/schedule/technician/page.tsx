"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink from "@/components/dashboard/DashboardBackLink";
import ServiceTerritoryField from "@/components/schedule/ServiceTerritoryField";
import StaffWorkHoursForm from "@/components/schedule/StaffWorkHoursForm";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getUsers,
  ServiceCity,
  updateUser,
  UserHomeLocation,
  UserListItem,
  UserWeeklyHours,
  validateCustomerAddress,
} from "@/lib/api";
import { userHasCapability } from "@/lib/dashboard-role";
import {
  defaultWeeklyHours,
  emptyHomeLocation,
  isDispatcherRole,
} from "@/lib/schedule";

const BACK_HREF = "/dashboard/schedule?tab=technicians";

export default function TechnicianEditPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <TechnicianEditor />
      </Suspense>
    </AuthGuard>
  );
}

function TechnicianEditor() {
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";
  const token = useAuthStore((s) => s.token);
  const viewer = useAuthStore((s) => s.user);

  const [snapshot, setSnapshot] = useState<{
    id: string;
    technician: UserListItem | null;
    error: string | null;
  } | null>(null);

  const [weeklyHours, setWeeklyHours] = useState<UserWeeklyHours>(
    defaultWeeklyHours(true),
  );
  const [home, setHome] = useState<UserHomeLocation>(emptyHomeLocation());
  const [serviceCities, setServiceCities] = useState<ServiceCity[]>([]);
  const [homeValidating, setHomeValidating] = useState(false);
  const [homeMsg, setHomeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (viewer && !isDispatcherRole(viewer)) {
      router.replace("/dashboard/schedule");
    }
  }, [viewer, router]);

  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    getUsers(token)
      .then(({ users }) => {
        if (cancelled) return;
        const match = users.find((user) => user._id === id);
        if (!match || !userHasCapability(match, "schedulable")) {
          setSnapshot({
            id,
            technician: null,
            error: "Technician not found.",
          });
          return;
        }
        setWeeklyHours(match.weeklyHours ?? defaultWeeklyHours(true));
        setHome(match.homeLocation ?? emptyHomeLocation());
        setServiceCities(match.serviceCities ?? []);
        setSnapshot({ id, technician: match, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setSnapshot({
          id,
          technician: null,
          error:
            err instanceof ApiError ? err.message : "Failed to load technician.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  const technician = snapshot?.id === id ? snapshot.technician : null;
  const error = snapshot?.id === id ? snapshot.error : null;
  const loading = Boolean(id) && snapshot?.id !== id;

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
    if (!token || !technician) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateUser(token, technician._id, {
        weeklyHours,
        homeLocation: home,
        serviceCities,
      });
      router.push(BACK_HREF);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save hours.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!viewer || !isDispatcherRole(viewer)) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }
  if (loading) {
    return <p className="text-sm text-neutral-500">Loading technician…</p>;
  }
  if (!technician) {
    return (
      <div className="space-y-3">
        <DashboardBackLink
          fallbackHref={BACK_HREF}
          fallbackLabel="Technicians"
        />
        <p className="text-sm text-red-700">{error || "Technician not found."}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col xl:h-[calc(100dvh-5.25rem)] xl:overflow-hidden">
      <DashboardBackLink
        fallbackHref={BACK_HREF}
        fallbackLabel="Technicians"
      />
      <h1 className="mt-3 text-lg font-semibold text-brand-dark">
        {technician.first_name} {technician.last_name}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-500">
        Weekly hours, home location, and service territory.
      </p>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="mt-4 flex min-h-0 flex-1 flex-col"
      >
        {saveError && (
          <div className="mb-4 shrink-0 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}
        <div className="grid min-h-0 flex-1 items-start gap-6 xl:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)] xl:items-stretch">
          <section className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 xl:overflow-y-auto">
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
          </section>
          <section className="flex min-h-0 flex-col rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 xl:overflow-hidden">
            <ServiceTerritoryField
              token={token}
              cities={serviceCities}
              onChange={setServiceCities}
            />
          </section>
        </div>
        <div className="sticky bottom-0 z-20 mt-4 flex shrink-0 justify-end gap-2 border-t border-neutral-200 bg-white py-3 xl:static">
          <button
            type="button"
            onClick={() => router.push(BACK_HREF)}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
