"use client";

import dynamic from "next/dynamic";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ArrowRight, Clock, Loader2, Paperclip, Smile, X } from "lucide-react";
import { ApiError, uploadInboxMedia } from "@/lib/api";

const InboxEmojiPicker = dynamic(() => import("./InboxEmojiPicker"), {
  ssr: false,
});

const MAX_FILES = 10;
const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,video/mp4,application/pdf,.vcf,text/vcard";

type Attachment = {
  id: string;
  name: string;
  previewUrl: string | null;
  status: "uploading" | "ready" | "error";
  url?: string;
  error?: string;
};

type InboxSmsComposerProps = {
  token: string;
  body: string;
  sending: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onBodyChange: (value: string) => void;
  onSend: (mediaUrls: string[]) => Promise<void>;
  onSchedule: (input: { mediaUrls: string[]; scheduledAt: string }) => Promise<void>;
};

function atTime(day: Date, hour: number, minute = 0): Date {
  const next = new Date(day);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function laterTodayOrTomorrow5(now: Date): { label: string; at: Date } {
  const today = atTime(now, 17);
  if (today.getTime() >= now.getTime() + 60_000) {
    return { label: "Later today 5 PM", at: today };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { label: "Tomorrow 5 PM", at: atTime(tomorrow, 17) };
}

function tomorrow9(now: Date): Date {
  const day = new Date(now);
  day.setDate(day.getDate() + 1);
  return atTime(day, 9);
}

function nextMonday9(now: Date): Date {
  const day = new Date(now);
  const weekday = day.getDay();
  let add = (1 - weekday + 7) % 7;
  if (add === 0 && atTime(now, 9).getTime() < now.getTime() + 60_000) add = 7;
  day.setDate(day.getDate() + add);
  return atTime(day, 9);
}

function toLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function segmentLabel(body: string): string | null {
  if (body.length <= 160) return null;
  const unicode = [...body].some((char) => (char.codePointAt(0) ?? 0) > 127);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = body.length <= single ? 1 : Math.ceil(body.length / multi);
  return `${body.length} · ${segments}`;
}

export default function InboxSmsComposer({
  token,
  body,
  sending,
  disabled = false,
  disabledReason,
  onBodyChange,
  onSend,
  onSchedule,
}: InboxSmsComposerProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customWhen, setCustomWhen] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [quickPicks, setQuickPicks] = useState<{ label: string; at: Date }[]>([]);
  const [scheduleBounds, setScheduleBounds] = useState({ min: "", max: "" });
  const boxRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const attachmentsRef = useRef<Attachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!emojiOpen && !scheduleOpen) return;
    function onPointer(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false);
        setScheduleOpen(false);
      }
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setEmojiOpen(false);
        setScheduleOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen, scheduleOpen]);

  const readyUrls = attachments
    .filter((item) => item.status === "ready" && item.url)
    .map((item) => item.url as string);
  const waitingOnFiles = attachments.some(
    (item) => item.status === "uploading" || item.status === "error",
  );
  const canSubmit =
    !disabled &&
    !sending &&
    !waitingOnFiles &&
    (body.trim().length > 0 || readyUrls.length > 0);
  const segments = segmentLabel(body);
  const uploadError = attachments.find((item) => item.error)?.error;

  function openSchedule() {
    const now = new Date();
    setQuickPicks([
      laterTodayOrTomorrow5(now),
      { label: "Tomorrow 9 AM", at: tomorrow9(now) },
      { label: "Monday 9 AM", at: nextMonday9(now) },
    ]);
    setScheduleBounds({
      min: toLocalValue(new Date(now.getTime() + 60_000)),
      max: toLocalValue(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)),
    });
    setEmojiOpen(false);
    setScheduleOpen(true);
  }

  function clearAttachments() {
    setAttachments((current) => {
      for (const item of current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
  }

  async function uploadOne(id: string, file: File) {
    try {
      const uploaded = await uploadInboxMedia(token, file);
      setAttachments((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "ready", url: uploaded.url } : item,
        ),
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Upload failed";
      setAttachments((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "error", error: message } : item,
        ),
      );
    }
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_FILES - attachments.length;
    if (room <= 0) {
      setAttachError("Attach 10 files or fewer");
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (picked.length < files.length) setAttachError("Attach 10 files or fewer");
    else setAttachError(null);
    const next = picked.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name || "attachment",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      status: "uploading" as const,
      file,
    }));
    setAttachments((current) => [
      ...current,
      ...next.map((item) => ({
        id: item.id,
        name: item.name,
        previewUrl: item.previewUrl,
        status: item.status,
      })),
    ]);
    for (const item of next) void uploadOne(item.id, item.file);
  }

  function insertEmoji(emoji: string) {
    const node = textRef.current;
    const start = node?.selectionStart ?? body.length;
    const end = node?.selectionEnd ?? body.length;
    onBodyChange(body.slice(0, start) + emoji + body.slice(end));
    const cursor = start + emoji.length;
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(cursor, cursor);
    });
  }

  async function submit() {
    if (!canSubmit) return;
    try {
      await onSend(readyUrls);
      clearAttachments();
      setEmojiOpen(false);
      setScheduleOpen(false);
      setAttachError(null);
    } catch {
      // The thread shows the error and keeps the draft.
    }
  }

  async function scheduleAt(at: Date) {
    if (!canSubmit) return;
    try {
      await onSchedule({ mediaUrls: readyUrls, scheduledAt: at.toISOString() });
      clearAttachments();
      setScheduleOpen(false);
      setCustomWhen("");
      setAttachError(null);
    } catch {
      // The thread shows the error and keeps the draft.
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      ref={boxRef}
      onSubmit={onSubmit}
      className="relative rounded-xl border border-[#2f6fed] bg-[var(--staff-surface)] px-3 pb-1.5 pt-2 focus-within:ring-1 focus-within:ring-[#2f6fed]"
    >
      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((item) => (
            <div key={item.id} className="relative" title={item.error || item.name}>
              {item.previewUrl ? (
                // Local preview of a file the user just picked.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className={`h-12 w-12 rounded-md object-cover ${item.status === "error" ? "opacity-40" : ""}`}
                />
              ) : (
                <span
                  className={`inline-flex max-w-[9rem] items-center rounded-md bg-[var(--staff-cream)] px-2 py-1 text-[11px] text-[var(--staff-ink)] ${
                    item.status === "error" ? "text-red-500" : ""
                  }`}
                >
                  <span className="truncate">{item.name}</span>
                </span>
              )}
              {item.status === "uploading" ? (
                <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-[var(--staff-ink)]" />
              ) : null}
              <button
                type="button"
                onClick={() => removeAttachment(item.id)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--staff-ink)] p-0.5 text-[var(--staff-surface)]"
                aria-label={`Remove ${item.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {disabled ? (
        <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">
          {disabledReason ||
            "This customer has opted out of text messages. They have to turn texts back on themselves."}
        </p>
      ) : null}
      <textarea
        ref={textRef}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        disabled={disabled}
        placeholder={disabled ? "Texts are turned off" : "Write a message…"}
        className="min-h-[2.5rem] w-full resize-none bg-transparent px-0.5 py-1 text-sm text-[var(--staff-ink)] outline-none placeholder:text-[var(--staff-muted)]"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md p-1.5 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)] hover:text-[var(--staff-ink)]"
            aria-label="Attach a file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setScheduleOpen(false);
              setEmojiOpen((open) => !open);
            }}
            className={`rounded-md p-1.5 hover:bg-[var(--staff-cream)] ${
              emojiOpen ? "text-[#2f6fed]" : "text-[var(--staff-muted)] hover:text-[var(--staff-ink)]"
            }`}
            aria-label="Add emoji"
            aria-expanded={emojiOpen}
          >
            <Smile className="h-4 w-4" />
          </button>
          <input
            id={fileInputId}
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          {segments ? (
            <span className="px-1 text-[10px] text-[var(--staff-muted)]">{segments}</span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (scheduleOpen) {
                setScheduleOpen(false);
                return;
              }
              openSchedule();
            }}
            disabled={!canSubmit && !scheduleOpen}
            className={`rounded-md p-1.5 hover:bg-[var(--staff-cream)] disabled:opacity-40 ${
              scheduleOpen ? "text-[#2f6fed]" : "text-[var(--staff-muted)] hover:text-[var(--staff-ink)]"
            }`}
            aria-label="Schedule send"
            aria-expanded={scheduleOpen}
          >
            <Clock className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md p-1.5 text-[var(--staff-ink)] hover:bg-[var(--staff-cream)] disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      {attachError || uploadError ? (
        <p className="px-1 pb-1 text-[11px] text-red-500">{attachError || uploadError}</p>
      ) : null}
      {emojiOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 overflow-hidden rounded-xl shadow-lg">
          <InboxEmojiPicker onPick={insertEmoji} />
        </div>
      ) : null}
      {scheduleOpen ? (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] p-2 shadow-lg">
          <p className="px-1 pb-1 text-[11px] font-medium text-[var(--staff-ink)]">Schedule send</p>
          <div className="flex flex-col">
            {quickPicks.map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={!canSubmit}
                onClick={() => void scheduleAt(option.at)}
                className="rounded-md px-2 py-1.5 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)] disabled:opacity-40"
              >
                <span className="block font-medium">{option.label}</span>
                <span className="text-[10px] text-[var(--staff-muted)]">{formatWhen(option.at)}</span>
              </button>
            ))}
          </div>
          <label className="mt-1 block px-1 text-[10px] text-[var(--staff-muted)]">
            Custom time
            <input
              type="datetime-local"
              value={customWhen}
              min={scheduleBounds.min}
              max={scheduleBounds.max}
              onChange={(event) => setCustomWhen(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-xs text-[var(--staff-ink)]"
            />
          </label>
          <button
            type="button"
            disabled={!canSubmit || !customWhen}
            onClick={() => void scheduleAt(new Date(customWhen))}
            className="mt-2 w-full rounded-md bg-[#2f6fed] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Schedule
          </button>
        </div>
      ) : null}
    </form>
  );
}
