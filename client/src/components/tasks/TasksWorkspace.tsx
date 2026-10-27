"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  TaskItem,
  deleteTask,
  getTasks,
  updateTask,
} from "@/lib/api";
import { subscribeDashboardLive } from "@/lib/dashboardLive";
import { useAuthStore } from "@/store/useAuthStore";
import TaskDialog from "./TaskDialog";

type TaskScope = "me" | "all";
type TaskChip = "overdue" | "today" | "upcoming" | "done";

function dueText(iso: string | null): { label: string; overdue: boolean } {
  if (!iso) return { label: "No due date", overdue: false };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "", overdue: false };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return {
    label: date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    overdue: date.getTime() < start.getTime(),
  };
}

export default function TasksWorkspace() {
  const token = useAuthStore((state) => state.token);
  const canWrite = useAuthStore((state) => state.hasPermission("tasks:write"));
  const [scope, setScope] = useState<TaskScope>("me");
  const [chip, setChip] = useState<TaskChip>("today");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const requestKey = `${scope}:${chip}:${refreshKey}`;
  const [loadedKey, setLoadedKey] = useState(requestKey);
  if (requestKey !== loadedKey) {
    setLoadedKey(requestKey);
    setLoading(true);
  }

  useEffect(() => {
    if (!token) return;
    return subscribeDashboardLive(token, () => setRefreshKey((value) => value + 1));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getTasks(token, {
      assignee: scope,
      status: chip === "done" ? "done" : "open",
      due: chip === "done" ? "" : chip,
    })
      .then((result) => {
        if (cancelled) return;
        setTasks(result.tasks);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load tasks");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, scope, chip, refreshKey]);

  async function complete(task: TaskItem) {
    if (!token || !canWrite) return;
    const next = task.status === "done" ? "open" : "done";
    const result = await updateTask(token, task.id, { status: next });
    setTasks((current) => current.map((item) => (item.id === result.task.id ? result.task : item)));
    setRefreshKey((value) => value + 1);
  }

  if (!token) return null;

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-[32rem] flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--staff-border)] px-4 py-3">
        <div className="flex items-center gap-4">
          {(
            [
              ["me", "My tasks"],
              ["all", "All tasks"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`border-b-2 pb-1 text-sm font-semibold ${
                scope === value
                  ? "border-[#2f6fed] text-[var(--staff-ink)]"
                  : "border-transparent text-[var(--staff-muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-[#2f6fed] px-3 py-1.5 text-xs font-medium text-white"
          >
            New task
          </button>
        ) : null}
      </div>
      <div className="flex gap-1.5 px-4 py-3">
        {(
          [
            ["overdue", "Overdue"],
            ["today", "Today"],
            ["upcoming", "Upcoming"],
            ["done", "Done"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setChip(value)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              chip === value
                ? "bg-[#2f6fed] text-white"
                : "bg-[var(--staff-cream)] text-[var(--staff-muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="px-4 pb-2 text-xs text-red-500">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && tasks.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--staff-muted)]">Loading tasks…</p>
        ) : null}
        {!loading && tasks.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--staff-muted)]">No tasks</p>
        ) : null}
        {tasks.map((task) => {
          const due = dueText(task.dueAt);
          const who = task.customerName || task.conversationName;
          const href = task.conversationId
            ? `/dashboard/inboxes?c=${task.conversationId}`
            : task.customerId
              ? `/dashboard/customers/detail?id=${task.customerId}`
              : "";
          return (
            <div
              key={task.id}
              className="flex items-start gap-3 border-b border-[var(--staff-border)] px-4 py-3"
            >
              <input
                type="checkbox"
                checked={task.status === "done"}
                disabled={!canWrite}
                aria-label={`Complete ${task.title}`}
                onChange={() => {
                  void complete(task).catch((err: unknown) => {
                    setError(err instanceof ApiError ? err.message : "Could not update the task");
                  });
                }}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setEditing(task)}
                  className={`block text-left text-sm text-[var(--staff-ink)] ${
                    task.status === "done" ? "line-through opacity-60" : "font-medium"
                  }`}
                >
                  {task.title}
                </button>
                <p className="mt-0.5 text-xs text-[var(--staff-muted)]">
                  {href && who ? (
                    <Link href={href} className="text-[#2f6fed] hover:underline">
                      {who}
                    </Link>
                  ) : (
                    who
                  )}
                  {who ? " · " : ""}
                  <span className={due.overdue && task.status === "open" ? "text-red-500" : ""}>
                    {due.label}
                  </span>
                  {scope === "all" && task.assigneeName ? ` · ${task.assigneeName}` : ""}
                </p>
              </div>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => {
                    void deleteTask(token, task.id)
                      .then(() => setRefreshKey((value) => value + 1))
                      .catch((err: unknown) => {
                        setError(err instanceof ApiError ? err.message : "Could not delete the task");
                      });
                  }}
                  className="text-[11px] text-[var(--staff-muted)] hover:text-red-500"
                >
                  Delete
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {creating ? (
        <TaskDialog
          token={token}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}
      {editing ? (
        <TaskDialog
          token={token}
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
