"use client";

import { useState } from "react";
import { ApiError, InboxTimelineMessage, dismissCallTaskPrompt, rateCallTranscript } from "@/lib/api";
import TaskDialog from "@/components/tasks/TaskDialog";

function dueFromDays(days: number | null | undefined): string | undefined {
  if (days == null || days < 0) return undefined;
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

export default function CallFollowUp({
  token,
  message,
  conversationId,
  customerId,
  displayName,
  canWrite,
  canTasks,
  onChange,
}: {
  token: string;
  message: InboxTimelineMessage;
  conversationId: string;
  customerId?: string;
  displayName: string;
  canWrite: boolean;
  canTasks: boolean;
  onChange: (patch: Partial<InboxTimelineMessage>) => void;
}) {
  const saved = message.transcriptRating;
  const [stars, setStars] = useState(saved?.stars ?? 0);
  const [comment, setComment] = useState(saved?.comment ?? "");
  const [editing, setEditing] = useState(!saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const pending = message.transcriptStatus === "pending";
  const showFollowUp = Boolean(message.transcript) && message.transcriptStatus !== "pending";
  const suggested = message.suggestedTask;
  const fallbackTitle = `Follow up with ${displayName || "customer"}`;

  async function saveRating() {
    if (!canWrite || stars < 1 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await rateCallTranscript(token, message.id, { stars, comment });
      onChange({ transcriptRating: result.rating });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the rating");
    } finally {
      setSaving(false);
    }
  }

  async function dismiss() {
    onChange({ taskPromptDismissed: true });
    try {
      await dismissCallTaskPrompt(token, message.id);
    } catch {
      onChange({ taskPromptDismissed: false });
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {pending ? <p className="text-[13px] text-[var(--staff-muted)]">Transcribing…</p> : null}
      {message.callSummary ? (
        <p className="whitespace-pre-wrap text-[13px] text-[var(--staff-ink)]">{message.callSummary}</p>
      ) : null}
      {message.transcript ? (
        <details className="text-[13px] text-[var(--staff-ink)]" open={message.transcript.length < 280}>
          <summary className="cursor-pointer text-[var(--staff-muted)]">Transcript</summary>
          <p className="mt-1 whitespace-pre-wrap">{message.transcript}</p>
        </details>
      ) : pending ? null : (
        <p className="text-[13px] text-[var(--staff-muted)]">No transcript yet.</p>
      )}
      {showFollowUp && canWrite ? (
        <div className="rounded-lg border border-[var(--staff-border)] px-2 py-2">
          <p className="text-[11px] font-medium text-[var(--staff-muted)]">Rate this transcript</p>
          <div className="mt-1 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                disabled={!editing}
                onClick={() => setStars(value)}
                className={`text-lg leading-none ${value <= stars ? "text-amber-500" : "text-[var(--staff-muted)]"} disabled:cursor-default`}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
              >
                ★
              </button>
            ))}
          </div>
          {editing ? (
            <>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Optional note, such as missed names or the wrong speaker"
                rows={2}
                className="mt-2 w-full rounded-md border border-[var(--staff-border)] bg-transparent px-2 py-1 text-xs text-[var(--staff-ink)]"
              />
              {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
              <button
                type="button"
                disabled={stars < 1 || saving}
                onClick={() => void saveRating()}
                className="mt-2 rounded-md bg-[#2f6fed] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <>
              {saved?.comment ? (
                <p className="mt-1 text-xs text-[var(--staff-ink)]">{saved.comment}</p>
              ) : null}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-1 text-xs font-medium text-[#2f6fed]"
              >
                Edit
              </button>
            </>
          )}
        </div>
      ) : null}
      {showFollowUp && canTasks && !message.taskPromptDismissed && !message.followUpTask ? (
        <div className="rounded-lg border border-[var(--staff-border)] px-2 py-2">
          <p className="text-[13px] text-[var(--staff-ink)]">Make a task from this call?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setTaskOpen(true)}
              className="rounded-md bg-[#2f6fed] px-2 py-1 text-xs font-medium text-white"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => void dismiss()}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
            >
              No thanks
            </button>
          </div>
        </div>
      ) : null}
      {message.followUpTask ? (
        <a
          href="/dashboard/tasks"
          className="inline-block text-xs font-medium text-[#2f6fed] hover:underline"
        >
          Task created: {message.followUpTask.title}
        </a>
      ) : null}
      {taskOpen ? (
        <TaskDialog
          token={token}
          draft={{
            title: suggested?.title || fallbackTitle,
            description: suggested?.description || message.transcript.slice(0, 500),
            conversationId,
            customerId,
            communicationId: message.id,
            dueAt: dueFromDays(suggested?.dueInDays),
          }}
          onClose={() => setTaskOpen(false)}
          onSaved={(task) => {
            setTaskOpen(false);
            onChange({ followUpTask: { id: task.id, title: task.title }, taskPromptDismissed: false });
          }}
        />
      ) : null}
    </div>
  );
}
