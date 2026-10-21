"use client";

import { useEffect, useRef, useState } from "react";
import {
  MentionableUser,
  NoteMention,
  searchMentionableUsers,
} from "@/lib/api";
import { earlierTimeFloor, suggestTimeTokens, timeTagLabels } from "@/lib/noteTimeTags";

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
  const [caret, setCaret] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);

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

  function syncQuery(next: string, nextCaret: number) {
    setCaret(nextCaret);
    const before = next.slice(0, nextCaret);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    const nextQuery = match ? match[2] : null;
    setQuery((current) => {
      if (current !== nextQuery) setActiveIndex(0);
      return nextQuery;
    });
  }

  function handleChange(next: string, caret: number) {
    const pruned = pruneMentions(next, mentionIds, knownMentions);
    onChange(next, pruned.mentionIds, pruned.mentions);
    syncQuery(next, caret);
  }

  function insertAt(label: string) {
    const area = areaRef.current;
    const caretPos = area?.selectionStart ?? caret;
    const before = value.slice(0, caretPos);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) return;
    const atIndex = before.length - match[2].length - 1;
    const next = `${value.slice(0, atIndex)}${label} ${value.slice(caretPos)}`;
    const cursor = atIndex + label.length + 1;
    return { next, cursor };
  }

  function selectTime(token: string) {
    const inserted = insertAt(token);
    if (!inserted) return;
    const pruned = pruneMentions(inserted.next, mentionIds, knownMentions);
    onChange(inserted.next, pruned.mentionIds, pruned.mentions);
    setQuery(null);
    const area = areaRef.current;
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function selectUser(user: MentionableUser) {
    const label = mentionLabel(user);
    const inserted = insertAt(label);
    if (!inserted) return;
    const { next } = inserted;
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
    const area = areaRef.current;
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  const beforeCaret = value.slice(0, caret);
  const activeAt = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
  const textBeforeAt = activeAt
    ? beforeCaret.slice(0, beforeCaret.length - activeAt[2].length - 1)
    : beforeCaret;
  const notBefore = query != null ? earlierTimeFloor(textBeforeAt) : "";
  const timeChoices = query != null ? suggestTimeTokens(query, notBefore) : [];
  const typingTime = query != null && /^\d/.test(query);
  const menuItems: Array<
    | { kind: "time"; token: string; label: string }
    | { kind: "user"; user: MentionableUser }
  > = [
    ...timeChoices.map((choice) => ({ kind: "time" as const, ...choice })),
    ...suggestions.map((user) => ({ kind: "user" as const, user })),
  ];
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
          if (!open || menuItems.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((index) => (index + 1) % menuItems.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((index) => (index - 1 + menuItems.length) % menuItems.length);
          } else if (e.key === "Enter" && menuItems[activeIndex]) {
            e.preventDefault();
            const item = menuItems[activeIndex];
            if (item.kind === "time") selectTime(item.token);
            else selectUser(item.user);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
          }
        }}
        className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
      />
      {open ? (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {menuItems.map((item, index) => (
            <li key={item.kind === "time" ? item.token : item.user.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (item.kind === "time") selectTime(item.token);
                  else selectUser(item.user);
                }}
                className={`flex w-full px-3 py-2 text-left text-sm ${
                  index === activeIndex
                    ? "bg-brand-orange/10 text-brand-dark"
                    : "text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {item.kind === "time"
                  ? item.label
                  : `${item.user.firstName} ${item.user.lastName}`}
              </button>
            </li>
          ))}
          {loading && menuItems.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-500">Searching staff…</li>
          ) : null}
          {!loading && menuItems.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-500">
              {typingTime ? "No later time" : "No staff match"}
            </li>
          ) : null}
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
  const labels = [
    ...timeTagLabels(content),
    ...(mentions ?? []).map((mention) => mentionLabel(mention)),
  ]
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
