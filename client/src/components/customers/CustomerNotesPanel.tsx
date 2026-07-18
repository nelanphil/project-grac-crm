"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createCustomerNote,
  CustomerNote,
  deleteCustomerNote,
  getCustomerNotes,
  updateCustomerNote,
} from "@/lib/api";
import CustomerNoteItem from "./CustomerNoteItem";

interface CustomerNotesPanelProps {
  token: string;
  customerId: string;
  userId: string;
  /** When set, only the first N notes are shown (newest first). */
  limit?: number;
  /** Link to the full notes page; shown when there are more notes than the limit. */
  viewAllHref?: string;
  /** When true, fetches notes (e.g. when the notes view is active). */
  enabled?: boolean;
  newNoteInputId?: string;
}

export default function CustomerNotesPanel({
  token,
  customerId,
  userId,
  limit,
  viewAllHref,
  enabled = true,
  newNoteInputId = "newCustomerNote",
}: CustomerNotesPanelProps) {
  const [notes, setNotes] = useState<CustomerNote[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [newNoteContent, setNewNoteContent] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true);
    setNotesError(null);
    try {
      const { notes: fetched } = await getCustomerNotes(token, customerId);
      setNotes(fetched);
      setNotesLoaded(true);
    } catch (err) {
      setNotesError(
        err instanceof ApiError ? err.message : "Failed to load notes.",
      );
    } finally {
      setLoadingNotes(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    if (enabled && !notesLoaded && !loadingNotes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadNotes();
    }
  }, [enabled, notesLoaded, loadingNotes, loadNotes]);

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    const content = newNoteContent.trim();
    if (!content) return;

    setAddingNote(true);
    setNotesError(null);
    try {
      const { note } = await createCustomerNote(token, customerId, content);
      setNotes((prev) => [note, ...prev]);
      setNewNoteContent("");
    } catch (err) {
      setNotesError(
        err instanceof ApiError ? err.message : "Failed to add note.",
      );
    } finally {
      setAddingNote(false);
    }
  }

  function startEdit(note: CustomerNote) {
    setEditingNoteId(note._id);
    setEditContent(note.content);
  }

  function cancelEdit() {
    setEditingNoteId(null);
    setEditContent("");
  }

  async function handleSaveEdit(noteId: string) {
    const content = editContent.trim();
    if (!content) return;

    setSavingEdit(true);
    setNotesError(null);
    try {
      const { note } = await updateCustomerNote(
        token,
        customerId,
        noteId,
        content,
      );
      setNotes((prev) => prev.map((n) => (n._id === noteId ? note : n)));
      cancelEdit();
    } catch (err) {
      setNotesError(
        err instanceof ApiError ? err.message : "Failed to update note.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;

    setDeletingNoteId(noteId);
    setNotesError(null);
    try {
      await deleteCustomerNote(token, customerId, noteId);
      setNotes((prev) => prev.filter((n) => n._id !== noteId));
      if (editingNoteId === noteId) cancelEdit();
    } catch (err) {
      setNotesError(
        err instanceof ApiError ? err.message : "Failed to delete note.",
      );
    } finally {
      setDeletingNoteId(null);
    }
  }

  const visibleNotes = limit != null ? notes.slice(0, limit) : notes;
  const hasMoreNotes = limit != null && notes.length > limit;

  return (
    <div className="space-y-4">
      {notesError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {notesError}
        </div>
      )}

      {loadingNotes ? (
        <p className="text-sm text-neutral-500">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-neutral-500">No notes yet.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {visibleNotes.map((note) => (
              <CustomerNoteItem
                key={note._id}
                note={note}
                userId={userId}
                isEditing={editingNoteId === note._id}
                editContent={editContent}
                savingEdit={savingEdit}
                deletingNoteId={deletingNoteId}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onEditContentChange={setEditContent}
                onSaveEdit={handleSaveEdit}
                onDelete={handleDeleteNote}
              />
            ))}
          </ul>

          {hasMoreNotes && viewAllHref && (
            <Link
              href={viewAllHref}
              className="inline-block text-sm font-medium text-brand-orange hover:underline"
            >
              View all notes ({notes.length})
            </Link>
          )}
        </>
      )}

      <form
        onSubmit={handleAddNote}
        className="space-y-2 border-t border-neutral-100 pt-4"
      >
        <label
          htmlFor={newNoteInputId}
          className="block text-xs font-medium uppercase tracking-wide text-neutral-400"
        >
          Add Note
        </label>
        <textarea
          id={newNoteInputId}
          value={newNoteContent}
          onChange={(e) => setNewNoteContent(e.target.value)}
          rows={3}
          placeholder="Write a note…"
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange resize-y"
        />
        <button
          type="submit"
          disabled={addingNote || !newNoteContent.trim()}
          className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {addingNote ? "Adding…" : "Add Note"}
        </button>
      </form>
    </div>
  );
}
