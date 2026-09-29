"use client";

import { useMemo, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import type { UserListItem } from "@/lib/api";

type EmailStaffTagsProps = {
  staff: UserListItem[];
  assigneeIds: string[];
  open: boolean;
  saving: boolean;
  error: string | null;
  onToggleOpen: () => void;
  onChange: (userIds: string[]) => void;
};

function displayName(user: UserListItem): string {
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return name || user.email;
}

function initials(user: UserListItem): string {
  const letters = `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`;
  return letters.toUpperCase() || user.email.slice(0, 2).toUpperCase();
}

export default function EmailStaffTags({
  staff,
  assigneeIds,
  open,
  saving,
  error,
  onToggleOpen,
  onChange,
}: EmailStaffTagsProps) {
  const [query, setQuery] = useState("");
  const byId = useMemo(
    () => new Map(staff.map((user) => [user._id, user])),
    [staff],
  );
  const tagged = assigneeIds
    .map((id) => byId.get(id))
    .filter((user): user is UserListItem => Boolean(user));
  const shown = tagged.slice(0, 3);
  const extra = assigneeIds.length - shown.length;
  const filtered = staff.filter((user) => {
    const haystack = `${displayName(user)} ${user.email}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  function toggle(userId: string) {
    if (saving) return;
    const next = assigneeIds.includes(userId)
      ? assigneeIds.filter((id) => id !== userId)
      : [...assigneeIds, userId];
    onChange(next);
  }

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-1.5">
        {shown.map((user) => (
          <span
            key={user._id}
            title={displayName(user)}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-brand-dark text-[9px] font-semibold text-white"
          >
            {initials(user)}
          </span>
        ))}
        {extra > 0 ? (
          <span className="text-[10px] font-medium text-neutral-500">+{extra}</span>
        ) : null}
        <button
          type="button"
          onClick={onToggleOpen}
          className="inline-flex h-5 items-center gap-1 rounded-full border border-[var(--staff-border)] bg-white px-1.5 text-[10px] font-medium text-neutral-600 hover:border-brand-orange hover:text-brand-dark"
          title="Tag staff"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <UserPlus className="h-3 w-3" />
          )}
          Tag
        </button>
      </div>
      {open ? (
        <div className="mt-2 rounded-md border border-[var(--staff-border)] bg-white p-2 shadow-sm">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search staff"
            className="mb-1 w-full rounded border border-[var(--staff-border)] px-2 py-1 text-[11px] outline-none focus:border-brand-orange"
          />
          <ul className="max-h-36 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-1 py-1 text-[11px] text-neutral-500">No staff found.</li>
            ) : (
              filtered.map((user) => {
                const checked = assigneeIds.includes(user._id);
                return (
                  <li key={user._id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-orange-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saving}
                        onChange={() => toggle(user._id)}
                      />
                      <span className="min-w-0 truncate text-neutral-800">
                        {displayName(user)}
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
          {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
