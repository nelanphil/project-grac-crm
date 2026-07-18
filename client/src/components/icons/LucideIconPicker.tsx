"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { iconNames, type IconName } from "lucide-react/dynamic";
import { Search } from "lucide-react";
import LucideIconByName from "@/components/icons/LucideIconByName";

const VISIBLE_LIMIT = 180;

type LucideIconPickerProps = {
  value: string;
  onChange: (name: string) => void;
};

export default function LucideIconPicker({ value, onChange }: LucideIconPickerProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filtered = useMemo(() => {
    const names = iconNames as IconName[];
    if (!deferredQuery) return names;
    return names.filter((name) => name.includes(deferredQuery));
  }, [deferredQuery]);

  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const remaining = filtered.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
          <LucideIconByName name={value || "scroll-text"} className="h-4 w-4 text-brand-dark" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Lucide icons…"
              className="w-full rounded-md border border-neutral-300 py-2 pl-8 pr-3 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
            />
          </div>
          <p className="mt-1 truncate text-xs text-neutral-500">
            Selected: <span className="font-mono text-neutral-700">{value || "scroll-text"}</span>
          </p>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2">
        {visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-neutral-500">No icons match.</p>
        ) : (
          <div className="grid grid-cols-8 gap-1 sm:grid-cols-10 md:grid-cols-12">
            {visible.map((name) => {
              const selected = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => onChange(name)}
                  className={`flex h-8 items-center justify-center rounded ${
                    selected
                      ? "bg-brand-dark text-white"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  <LucideIconByName name={name} className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        )}
        {remaining > 0 && (
          <p className="mt-2 text-center text-xs text-neutral-400">
            Showing {visible.length} of {filtered.length} — refine search to narrow results
          </p>
        )}
      </div>
    </div>
  );
}
