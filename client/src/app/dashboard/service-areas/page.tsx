"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import {
  ApiError,
  getServiceAreas,
  saveServiceAreas,
  type ServiceAreaInput,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

type DraftCity = { name: string };
type DraftArea = { key: string; name: string; cities: DraftCity[]; cityDraft: string };

function newKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDraft(
  areas: { name: string; cities: { name: string }[] }[],
): DraftArea[] {
  return areas.map((area) => ({
    key: newKey(),
    name: area.name,
    cities: area.cities.map((city) => ({ name: city.name })),
    cityDraft: "",
  }));
}

export default function ServiceAreasPage() {
  return (
    <AuthGuard>
      <ServiceAreasEditor />
    </AuthGuard>
  );
}

function ServiceAreasEditor() {
  const token = useAuthStore((s) => s.token);
  const [areas, setAreas] = useState<DraftArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getServiceAreas(token)
      .then(({ areas: list }) => {
        if (!cancelled) {
          setAreas(toDraft(list));
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load service areas.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function updateArea(key: string, patch: Partial<DraftArea>) {
    setAreas((current) =>
      current.map((area) => (area.key === key ? { ...area, ...patch } : area)),
    );
    setSaveOk(null);
  }

  function addArea() {
    setAreas((current) => [
      ...current,
      { key: newKey(), name: "", cities: [], cityDraft: "" },
    ]);
    setSaveOk(null);
  }

  function removeArea(key: string) {
    const area = areas.find((item) => item.key === key);
    if (
      area &&
      area.cities.length > 0 &&
      !window.confirm(`Remove ${area.name || "this area"} and its cities?`)
    ) {
      return;
    }
    setAreas((current) => current.filter((item) => item.key !== key));
    setSaveOk(null);
  }

  function addCity(key: string) {
    setAreas((current) =>
      current.map((area) => {
        if (area.key !== key) return area;
        const name = area.cityDraft.trim();
        if (!name) return area;
        return {
          ...area,
          cityDraft: "",
          cities: [...area.cities, { name }],
        };
      }),
    );
    setSaveError(null);
    setSaveOk(null);
  }

  function removeCity(areaKey: string, index: number) {
    setAreas((current) =>
      current.map((area) =>
        area.key === areaKey
          ? {
              ...area,
              cities: area.cities.filter((_, cityIndex) => cityIndex !== index),
            }
          : area,
      ),
    );
    setSaveOk(null);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);

    const payload: ServiceAreaInput[] = areas.map((area) => ({
      name: area.name.trim(),
      cities: [
        ...area.cities.map((city) => city.name.trim()),
        area.cityDraft.trim(),
      ]
        .filter(Boolean)
        .map((name) => ({ name })),
    }));

    try {
      const { areas: saved } = await saveServiceAreas(token, payload);
      setAreas(toDraft(saved));
      setSaveOk("Service areas saved.");
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save service areas.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Service Areas</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Define the Florida regions shown on the website. Each city belongs
            to one area. With more than one area, add that area’s cities on its
            own list.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving || loading}
          className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {saveOk ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {saveOk}
        </div>
      ) : null}
      {saveError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-neutral-500">Loading service areas…</div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-4">
          {areas.length === 1 ? (
            <p className="text-sm text-neutral-500">
              This area’s cities are the full service list. Add another area
              when you want to split cities by region.
            </p>
          ) : null}

          {areas.map((area) => (
            <section
              key={area.key}
              className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="min-w-0 flex-1 text-sm font-medium text-brand-dark">
                  Area name
                  <input
                    value={area.name}
                    onChange={(event) =>
                      updateArea(area.key, { name: event.target.value })
                    }
                    placeholder="Central Florida"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-normal text-brand-dark"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeArea(area.key)}
                  className="mt-6 inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-red-300 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>

              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {area.cities.map((city, index) => (
                  <li
                    key={`${area.key}-${city.name}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700"
                  >
                    <span>{city.name}</span>
                    <button
                      type="button"
                      onClick={() => removeCity(area.key, index)}
                      className="text-neutral-400 hover:text-red-700"
                      aria-label={`Remove ${city.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  value={area.cityDraft}
                  onChange={(event) =>
                    updateArea(area.key, { cityDraft: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCity(area.key);
                    }
                  }}
                  placeholder="Add a city"
                  className="min-w-[12rem] flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-brand-dark"
                />
                <button
                  type="button"
                  onClick={() => addCity(area.key)}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange"
                >
                  <Plus className="h-4 w-4" />
                  Add city
                </button>
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={addArea}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-4 py-2 text-sm font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange"
          >
            <Plus className="h-4 w-4" />
            Add area
          </button>
        </div>
      )}
    </form>
  );
}
