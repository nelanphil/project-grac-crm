"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { FLORIDA_COUNTIES } from "@/lib/floridaCounties";
import type { TerritoryOwner, UserTerritories } from "@/lib/api";
import TerritoryMap from "@/components/territory/TerritoryMap";

function normalizeZipInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

interface TerritoryEditorProps {
  initial: UserTerritories;
  saving?: boolean;
  error?: string | null;
  onSave: (territories: UserTerritories) => Promise<void>;
  submitLabel?: string;
  /** Other owners (not the one being edited) — used to paint claimed areas. */
  otherOwners?: TerritoryOwner[];
  showMap?: boolean;
}

export default function TerritoryEditor({
  initial,
  saving = false,
  error = null,
  onSave,
  submitLabel = "Save territory",
  otherOwners = [],
  showMap = true,
}: TerritoryEditorProps) {
  const [counties, setCounties] = useState<string[]>(initial.counties ?? []);
  const [zips, setZips] = useState<string[]>(initial.zips ?? []);
  const [zipDraft, setZipDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  // Reset local state during render (instead of an effect) when a new `initial` arrives.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setCounties(initial.counties ?? []);
    setZips(initial.zips ?? []);
    setZipDraft("");
    setDirty(false);
  }

  function toggleCounty(county: string) {
    setDirty(true);
    setCounties((prev) => {
      const has = prev.includes(county);
      return has
        ? prev.filter((c) => c !== county)
        : [...prev, county].sort((a, b) => a.localeCompare(b));
    });
  }

  function toggleZip(zip: string) {
    const normalized = normalizeZipInput(zip);
    if (normalized.length !== 5) return;
    setDirty(true);
    setZips((prev) => {
      const has = prev.includes(normalized);
      return has
        ? prev.filter((z) => z !== normalized)
        : [...prev, normalized].sort();
    });
  }

  function addZip(raw: string) {
    const zip = normalizeZipInput(raw);
    if (zip.length !== 5) return;
    setDirty(true);
    setZips((prev) => (prev.includes(zip) ? prev : [...prev, zip].sort()));
    setZipDraft("");
  }

  function removeZip(zip: string) {
    setDirty(true);
    setZips((prev) => prev.filter((z) => z !== zip));
  }

  function onZipKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (zipDraft.trim()) {
        e.preventDefault();
        addZip(zipDraft);
      }
    } else if (e.key === "Backspace" && !zipDraft && zips.length) {
      removeZip(zips[zips.length - 1]!);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let nextZips = zips;
    if (zipDraft.trim()) {
      const zip = normalizeZipInput(zipDraft);
      if (zip.length === 5 && !zips.includes(zip)) {
        nextZips = [...zips, zip].sort();
        setZips(nextZips);
      }
      setZipDraft("");
    }
    try {
      await onSave({ counties, zips: nextZips });
      setDirty(false);
    } catch {
      // Parent surfaces the error; keep dirty so Save stays enabled.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {showMap ? (
        <TerritoryMap
          counties={counties}
          zips={zips}
          otherOwners={otherOwners}
          onToggleCounty={toggleCounty}
          onToggleZip={toggleZip}
          disabled={saving}
        />
      ) : null}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-brand-dark">
            Florida counties ({counties.length} selected)
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setDirty(true);
                setCounties([...FLORIDA_COUNTIES]);
              }}
              className="text-xs font-medium text-brand-orange hover:underline"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => {
                setDirty(true);
                setCounties([]);
              }}
              disabled={counties.length === 0}
              className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          Select the counties this owner covers. Use ZIP carve-outs when two
          owners share a county.
        </p>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {FLORIDA_COUNTIES.map((county) => {
            const checked = counties.includes(county);
            return (
              <label
                key={county}
                className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
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
        <p className="text-sm font-medium text-brand-dark">ZIP carve-outs</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          Exclusive ZIPs override county ownership for that ZIP.
        </p>
        <div className="mt-2 flex min-h-[42px] flex-wrap gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-2">
          {zips.map((zip) => (
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
            onChange={(e) => setZipDraft(normalizeZipInput(e.target.value))}
            onKeyDown={onZipKeyDown}
            onBlur={() => {
              if (zipDraft.length === 5) addZip(zipDraft);
            }}
            placeholder={zips.length ? "Add ZIP…" : "e.g. 32789"}
            className="min-w-[5rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saving ? (
          <p className="text-xs text-neutral-500">Saving territory…</p>
        ) : null}
        <button
          type="submit"
          disabled={saving || !dirty}
          className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
