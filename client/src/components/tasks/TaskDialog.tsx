"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  TaskAssignee,
  TaskItem,
  TechnicianListItem,
  completeTask,
  createTask,
  getTaskAssignees,
  getTechnicians,
  reopenTask,
  updateTask,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

type TaskDraft = {
  title?: string;
  description?: string;
  conversationId?: string;
  customerId?: string;
  communicationId?: string;
  dueAt?: string;
};

type TaskDialogProps = {
  token: string;
  task?: TaskItem | null;
  draft?: TaskDraft;
  onClose: () => void;
  onSaved: (task: TaskItem) => void;
};

function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

function quickDue(dayOffset: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return localInput(date);
}

export default function TaskDialog({
  token,
  task,
  draft,
  onClose,
  onSaved,
}: TaskDialogProps) {
  const me = useAuthStore((state) => state.user);
  const [title, setTitle] = useState(task?.title || draft?.title || "");
  const [description, setDescription] = useState(task?.description || draft?.description || "");
  const [due, setDue] = useState(
    task?.dueAt
      ? localInput(new Date(task.dueAt))
      : draft?.dueAt
        ? localInput(new Date(draft.dueAt))
        : "",
  );
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || me?.id || "");
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [onSchedule, setOnSchedule] = useState(Boolean(task?.onSchedule));
  const [technicianId, setTechnicianId] = useState(task?.scheduledTechnicianId || "");
  const [technicians, setTechnicians] = useState<TechnicianListItem[]>([]);
  const [scheduledAt, setScheduledAt] = useState(
    task?.scheduledStart ? localInput(new Date(task.scheduledStart)) : "",
  );
  const [minutes, setMinutes] = useState(task?.scheduledMinutes || 30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTaskAssignees(token)
      .then((result) => setAssignees(result.assignees))
      .catch(() => setAssignees([]));
    getTechnicians(token, { all: true })
      .then((result) => setTechnicians(result.technicians))
      .catch(() => setTechnicians([]));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    const dueAt = fromLocalInput(due);
    const schedule = onSchedule
      ? {
          onSchedule: true,
          scheduledTechnicianId: technicianId || null,
          scheduledStart: fromLocalInput(scheduledAt),
          scheduledMinutes: minutes,
        }
      : {
          onSchedule: false,
          scheduledTechnicianId: null,
          scheduledStart: null,
        };
    try {
      const result = task
        ? await updateTask(token, task.id, {
            title: title.trim(),
            description: description.trim(),
            dueAt,
            assigneeId: assigneeId || null,
            ...schedule,
          })
        : await createTask(token, {
            title: title.trim(),
            description: description.trim(),
            dueAt,
            assigneeId: assigneeId || null,
            conversationId: draft?.conversationId,
            customerId: draft?.customerId,
            communicationId: draft?.communicationId,
            source: draft?.conversationId ? "inbox" : "manual",
            ...schedule,
          });
      onSaved(result.task);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the task");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-[var(--staff-ink)]">
          {task ? "Edit task" : "Create new task"}
        </h2>
        <label className="mt-3 block text-xs font-medium text-[var(--staff-muted)]">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-[var(--staff-muted)]">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="mt-1 w-full resize-none rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-[var(--staff-muted)]">
          Due
          <input
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              ["Today", quickDue(0, 17)],
              ["Tomorrow", quickDue(1, 9)],
              ["Next week", quickDue(7, 9)],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => setDue(value)}
              className="rounded-full bg-[var(--staff-cream)] px-2.5 py-1 text-[11px] font-medium text-[var(--staff-muted)]"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-xs font-medium text-[var(--staff-muted)]">
          Assignee
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
          >
            {me ? (
              <option value={me.id}>
                {`${me.first_name} ${me.last_name}`.trim() || "Me"}
              </option>
            ) : null}
            {assignees
              .filter((person) => person.id !== me?.id)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-[var(--staff-muted)]">
          <input
            type="checkbox"
            checked={onSchedule}
            onChange={(event) => setOnSchedule(event.target.checked)}
          />
          Add to a technician&apos;s schedule
        </label>
        {onSchedule ? (
          <div className="mt-2 space-y-3 rounded-md border border-[var(--staff-border)] p-2">
            <label className="block text-xs font-medium text-[var(--staff-muted)]">
              Technician
              <select
                value={technicianId}
                onChange={(event) => setTechnicianId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
              >
                <option value="">Choose later</option>
                {technicians.map((person) => (
                  <option key={person._id} value={person._id}>
                    {`${person.first_name} ${person.last_name}`.trim()}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-[var(--staff-muted)]">
              Date and time
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
              />
            </label>
            <p className="text-[11px] text-[var(--staff-muted)]">
              Leave the time empty to drop it onto the schedule later.
            </p>
            <label className="block text-xs font-medium text-[var(--staff-muted)]">
              Duration
              <select
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
              >
                {!DURATIONS.includes(minutes) ? (
                  <option value={minutes}>{minutes} min</option>
                ) : null}
                {DURATIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} min
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          {task ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setError(null);
                const action = task.status === "done" ? reopenTask : completeTask;
                void action(token, task.id)
                  .then((result) => onSaved(result.task))
                  .catch((err: unknown) => {
                    setError(err instanceof ApiError ? err.message : "Could not update the task");
                    setSaving(false);
                  });
              }}
              className="mr-auto rounded-md px-3 py-1.5 text-xs font-medium text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
            >
              {task.status === "done" ? "Reopen" : "Mark done"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="rounded-md bg-[#2f6fed] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : task ? "Save" : "Create task"}
          </button>
        </div>
      </form>
    </div>
  );
}
