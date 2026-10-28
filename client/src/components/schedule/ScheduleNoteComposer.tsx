"use client";

import { useState } from "react";
import { ApiError, createWorkOrderNote } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

export function ScheduleNoteComposer({
  workOrderId,
  onSaved,
  onCancel,
}: {
  workOrderId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const text = content.trim();
    if (!token || !text || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createWorkOrderNote(token, workOrderId, {
        content: text,
        showOnSchedule: true,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to add note.");
      setSaving(false);
    }
  }

  return (
    <div
      className="mt-2 space-y-2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <textarea
        value={content}
        rows={2}
        autoFocus
        placeholder="Note for the technician schedule"
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="w-full resize-y rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-brand-dark"
      />
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[11px] font-medium text-neutral-500 hover:underline disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !content.trim()}
          className="text-[11px] font-medium text-brand-orange hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
