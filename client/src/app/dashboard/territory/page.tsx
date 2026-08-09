"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import TerritoryEditor from "@/components/territory/TerritoryEditor";
import {
  ApiError,
  TerritoryOwner,
  UserTerritories,
  getTerritories,
  recalculateTerritories,
  updateTerritories,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const TERRITORY_ROLES = ["admin", "super-admin", "owner"];

export default function TerritoryPage() {
  return (
    <AuthGuard>
      <TerritoryPageContent />
    </AuthGuard>
  );
}

function TerritoryPageContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isAllowed = user ? TERRITORY_ROLES.includes(user.role) : false;
  const isOrgAdmin = user?.role === "admin" || user?.role === "super-admin";

  const [owners, setOwners] = useState<TerritoryOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    if (user && !isAllowed) {
      router.replace("/dashboard");
    }
  }, [user, isAllowed, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { owners: list } = await getTerritories(token);
      setOwners(list);
      setSelectedId((prev) => {
        if (prev && list.some((o) => o._id === prev)) return prev;
        if (user?.role === "owner") {
          return (
            list.find((o) => o._id === user.id)?._id ?? list[0]?._id ?? null
          );
        }
        return list[0]?._id ?? null;
      });
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load territories.",
      );
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    if (isAllowed && token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [isAllowed, token, load]);

  async function handleRecalculate() {
    if (!token) return;
    setRecalculating(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const { reassignment } = await recalculateTerritories(token);
      setSaveOk(
        `Recalculated ownership from ZIP→county: assigned ${reassignment.assigned} of ${reassignment.processed} customers. Refresh Customers to see owners.`,
      );
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to recalculate ownership.",
      );
    } finally {
      setRecalculating(false);
    }
  }

  async function handleSave(ownerId: string, territories: UserTerritories) {
    if (!token) {
      const msg = "You are not signed in.";
      setSaveError(msg);
      throw new Error(msg);
    }
    setSavingId(ownerId);
    setSaveError(null);
    setSaveOk(null);
    try {
      const { owner } = await updateTerritories(token, ownerId, territories);
      setOwners((prev) => prev.map((o) => (o._id === ownerId ? owner : o)));
      setSaveOk(
        "Territory saved. Customer ownership is recalculating in the background — refresh Customers in a moment.",
      );
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to save territory.";
      setSaveError(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setSavingId(null);
    }
  }

  if (!user || !isAllowed) return null;

  const selected =
    owners.find((o) => o._id === selectedId) ?? owners[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Territory</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {user.role === "owner"
              ? "Assign the Florida counties and ZIP carve-outs you cover. Customers in your territory are assigned to you automatically."
              : "Manage owner territories by county and ZIP. ZIP claims override county ownership when owners share a county."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRecalculate()}
          disabled={recalculating}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange disabled:opacity-60"
        >
          {recalculating ? "Recalculating…" : "Recalculate ownership"}
        </button>
      </div>

      {saveOk && !selected ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {saveOk}
        </div>
      ) : null}
      {saveError && !selected ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-neutral-500">Loading territories…</div>
      ) : loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      ) : owners.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-10 text-center text-sm text-neutral-500 shadow-sm">
          {isOrgAdmin
            ? "No users with the Owner role yet. Create an owner in Users, then assign their territory here."
            : "Your account is not set up as an owner."}
        </div>
      ) : (
        <div
          className={
            isOrgAdmin && owners.length > 1
              ? "grid gap-6 lg:grid-cols-[240px_1fr]"
              : "space-y-4"
          }
        >
          {isOrgAdmin && owners.length > 1 ? (
            <aside className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden h-fit">
              <div className="border-b border-neutral-100 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Owners
                </p>
              </div>
              <ul className="divide-y divide-neutral-100">
                {owners.map((owner) => {
                  const active = owner._id === selected?._id;
                  const count =
                    (owner.territories.counties?.length ?? 0) +
                    (owner.territories.zips?.length ?? 0);
                  return (
                    <li key={owner._id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(owner._id);
                          setSaveError(null);
                          setSaveOk(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                          active
                            ? "bg-brand-dark/5 text-brand-dark"
                            : "text-neutral-700 hover:bg-neutral-50"
                        }`}
                      >
                        <span className="block font-medium">
                          {owner.first_name} {owner.last_name}
                        </span>
                        <span className="mt-0.5 block text-xs text-neutral-500">
                          {count === 0
                            ? "No territory"
                            : `${owner.territories.counties.length} counties · ${owner.territories.zips.length} ZIPs`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}

          {selected ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
              {isOrgAdmin ? (
                <div>
                  <h2 className="text-lg font-semibold text-brand-dark">
                    {selected.first_name} {selected.last_name}
                  </h2>
                  <p className="text-sm text-neutral-500">{selected.email}</p>
                </div>
              ) : (
                <div>
                  <h2 className="text-lg font-semibold text-brand-dark">
                    Your territory
                  </h2>
                  <p className="text-sm text-neutral-500">
                    Changes apply immediately to customer ownership.
                  </p>
                </div>
              )}

              {saveOk ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                  {saveOk}
                </div>
              ) : null}

              <TerritoryEditor
                key={selected._id}
                initial={selected.territories}
                saving={savingId === selected._id}
                error={saveError}
                otherOwners={owners.filter((o) => o._id !== selected._id)}
                onSave={(territories) => handleSave(selected._id, territories)}
                submitLabel={
                  user.role === "owner" ? "Save my territory" : "Save territory"
                }
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
