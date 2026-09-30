"use client";

import { useEffect, useRef, useState } from "react";
import {
  MentionableUser,
  NoteMention,
  searchMentionableUsers,
} from "@/lib/api";

function mentionLabel(person: { firstName: string; lastName: string }): string {
  return `@${`${person.firstName} ${person.lastName}`.replace(/\s+/g, " ").trim()}`;
}

function pruneMentions(
  value: string,
  mentionIds: string[],
  known: NoteMention[],
): { mentionIds: string[]; mentions: NoteMention[] } {
  const kept = known.filter(
    (mention) =>
      mentionIds.includes(mention.id) && value.includes(mentionLabel(mention)),
  );
  return {
    mentionIds: kept.map((mention) => mention.id),
    mentions: kept,
  };
}

export default function MentionTextarea({
  token,
  value,
  mentionIds,
  knownMentions,
  onChange,
  rows = 4,
  placeholder,
}: {
  token: string;
  value: string;
  mentionIds: string[];
  knownMentions: NoteMention[];
  onChange: (value: string, mentionIds: string[], mentions: NoteMention[]) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MentionableUser[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(0);

  useEffect(() => {
    if (query == null) return;
    const handle = setTimeout(() => {
      setLoading(true);
      searchMentionableUsers(token, query)
        .then(({ users }) => {
          setSuggestions(users);
          setActiveIndex(0);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, token]);

  function syncQuery(next: string, caret: number) {
    caretRef.current = caret;
    const before = next.slice(0, caret);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    setQuery(match ? match[2] : null);
  }

  function handleChange(next: string, caret: number) {
    const pruned = pruneMentions(next, mentionIds, knownMentions);
    onChange(next, pruned.mentionIds, pruned.mentions);
    syncQuery(next, caret);
  }

  function selectUser(user: MentionableUser) {
    const area = areaRef.current;
    const caret = area?.selectionStart ?? caretRef.current;
    const before = value.slice(0, caret);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) return;
    const atIndex = before.length - match[2].length - 1;
    const label = mentionLabel(user);
    const next = `${value.slice(0, atIndex)}${label} ${value.slice(caret)}`;
    const mention: NoteMention = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    };
    const mentions = [
      ...knownMentions.filter((item) => item.id !== user.id),
      mention,
    ];
    const ids = mentions.map((item) => item.id);
    onChange(next, ids, mentions);
    setQuery(null);
    const cursor = atIndex + label.length + 1;
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(cursor, cursor);
    });
  }

  const open = query != null;

  return (
    <div className="relative">
      <textarea
        ref={areaRef}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onClick={(e) =>
          syncQuery(value, (e.target as HTMLTextAreaElement).selectionStart ?? value.length)
        }
        onKeyUp={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") return;
          syncQuery(value, (e.target as HTMLTextAreaElement).selectionStart ?? value.length);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((index) =>
              suggestions.length === 0 ? 0 : (index + 1) % suggestions.length,
            );
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((index) =>
              suggestions.length === 0
                ? 0
                : (index - 1 + suggestions.length) % suggestions.length,
            );
          } else if (e.key === "Enter" && suggestions[activeIndex]) {
            e.preventDefault();
            selectUser(suggestions[activeIndex]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
          }
        }}
        className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
      />
      {open ? (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {loading ? (
            <li className="px-3 py-2 text-sm text-neutral-500">Searching staff…</li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-500">No staff match</li>
          ) : (
            suggestions.map((user, index) => (
              <li key={user.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectUser(user);
                  }}
                  className={`flex w-full px-3 py-2 text-left text-sm ${
                    index === activeIndex
                      ? "bg-brand-orange/10 text-brand-dark"
                      : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {user.firstName} {user.lastName}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function NoteBody({
  content,
  mentions,
}: {
  content: string;
  mentions?: NoteMention[];
}) {
  const labels = (mentions ?? [])
    .map((mention) => mentionLabel(mention))
    .filter((label) => label.length > 1)
    .sort((a, b) => b.length - a.length);

  if (labels.length === 0) {
    return (
      <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{content}</p>
    );
  }

  const pattern = new RegExp(
    `(${labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  const parts = content.split(pattern);

  return (
    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">
      {parts.map((part, index) =>
        labels.includes(part) ? (
          <span
            key={`${part}-${index}`}
            className="rounded bg-brand-orange/10 px-0.5 font-medium text-brand-dark"
          >
            {part}
          </span>
        ) : (
          <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>
        ),
      )}
    </p>
  );
}
