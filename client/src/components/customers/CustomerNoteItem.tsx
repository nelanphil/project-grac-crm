"use client";

import { CustomerNote } from "@/lib/api";

export function formatNoteDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface CustomerNoteItemProps {
  note: CustomerNote;
  userId: string;
  isEditing: boolean;
  editContent: string;
  savingEdit: boolean;
  deletingNoteId: string | null;
  onStartEdit: (note: CustomerNote) => void;
  onCancelEdit: () => void;
  onEditContentChange: (value: string) => void;
  onSaveEdit: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

export default function CustomerNoteItem({
  note,
  userId,
  isEditing,
  editContent,
  savingEdit,
  deletingNoteId,
  onStartEdit,
  onCancelEdit,
  onEditContentChange,
  onSaveEdit,
  onDelete,
}: CustomerNoteItemProps) {
  const isAuthor = note.authorId === userId;

  return (
    <li className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-brand-dark">
            {note.author.first_name} {note.author.last_name}
          </p>
          <p className="text-xs text-neutral-400">
            {formatNoteDate(note.createdAt)}
            {note.updatedAt !== note.createdAt && " (edited)"}
          </p>
        </div>
        {isAuthor && !isEditing && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onStartEdit(note)}
              className="text-xs font-medium text-brand-orange hover:underline"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(note._id)}
              disabled={deletingNoteId === note._id}
              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
            >
              {deletingNoteId === note._id ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange resize-y"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSaveEdit(note._id)}
              disabled={savingEdit || !editContent.trim()}
              className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {savingEdit ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={savingEdit}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{note.content}</p>
      )}
    </li>
  );
}
