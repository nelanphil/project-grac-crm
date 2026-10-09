"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, StickyNote, Search } from "lucide-react";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import {
  ApiError,
  getWorkOrderNoteHistory,
  updateWorkOrderNote,
  type WorkOrderNoteHistoryItem,
} from "@/lib/api";
import { paginationRange, type PageSize } from "@/lib/pagination";

const NOTE_PAGE_SIZES = [50, 150, 250] as const;

type SortKey = "note" | "ticket" | "customer" | "created";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === column;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 transition-colors hover:text-brand-dark"
      >
        {label}
        <Icon
          className={`h-3.5 w-3.5 ${active ? "text-brand-dark" : "text-neutral-300"}`}
        />
      </button>
    </th>
  );
}

function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function NoteEditor({
  item,
  token,
  onSaved,
  onCancel,
}: {
  item: WorkOrderNoteHistoryItem;
  token: string;
  onSaved: (id: string, content: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(item.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const content = draft.trim();
    if (!content || saving) return;
    if (content === item.content.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateWorkOrderNote(token, item.workOrderId, item.id, { content });
      onSaved(item.id, content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update note.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={4}
        aria-label={`Edit note on work order ${item.ticketNumber}`}
        className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-brand-orange"
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !draft.trim()}
          className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function NoteBody({
  item,
  token,
  editing,
  onEdit,
  onSaved,
  onCancel,
}: {
  item: WorkOrderNoteHistoryItem;
  token: string;
  editing: boolean;
  onEdit: () => void;
  onSaved: (id: string, content: string) => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <NoteEditor item={item} token={token} onSaved={onSaved} onCancel={onCancel} />
    );
  }
  return (
    <div>
      <p className="whitespace-pre-wrap">{item.content}</p>
      {item.canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="mt-2 text-sm font-medium text-brand-orange hover:underline"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

export default function NotesHistoryPanel({ token }: { token: string }) {
  const [items, setItems] = useState<WorkOrderNoteHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = search.trim();
      setDebounced((current) => {
        if (next !== current) setLoading(true);
        return next;
      });
      setPage(1);
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    getWorkOrderNoteHistory(token, {
      page,
      pageSize,
      search: debounced || undefined,
      sort: sortKey,
      dir: sortDir,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.notes);
        setTotal(res.total);
        setError(null);
        setEditingId(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load notes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, debounced, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    setLoading(true);
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
    }
    setPage(1);
  }

  function handleSaved(id: string, content: string) {
    setItems((prev) =>
      prev.map((row) => (row.id === id ? { ...row, content } : row)),
    );
    setEditingId(null);
  }

  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    total,
  );

  const paginationProps = {
    rangeStart,
    rangeEnd,
    total,
    pageSize,
    safePage,
    totalPages,
    pageSizeOptions: NOTE_PAGE_SIZES,
    onPageSizeChange: (size: PageSize) => {
      setLoading(true);
      setPageSize(size);
      setPage(1);
    },
    onPrev: () => {
      setLoading(true);
      setPage((current) => Math.max(1, current - 1));
    },
    onNext: () => {
      setLoading(true);
      setPage((current) => Math.min(totalPages, current + 1));
    },
  };

  return (
    <div className="space-y-4">
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search note, work order, or customer"
          className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading notes…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={items.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <StickyNote className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">
                {debounced ? "No notes match your search" : "No notes yet."}
              </p>
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {items.map((item) => (
                <MobileDataCard
                  key={item.id}
                  title={item.ticketNumber}
                  subtitle={item.customerName || "—"}
                  fields={
                    <>
                      <DataField
                        label="Note"
                        value={
                          <NoteBody
                            item={item}
                            token={token}
                            editing={editingId === item.id}
                            onEdit={() => setEditingId(item.id)}
                            onSaved={handleSaved}
                            onCancel={() => setEditingId(null)}
                          />
                        }
                      />
                      <DataField label="Created" value={formatCreated(item.createdAt)} />
                    </>
                  }
                />
              ))}
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="bottom" />
              </div>
            </div>
          }
          desktop={
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <TablePagination {...paginationProps} position="top" />
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <SortHeader
                      label="Note"
                      column="note"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Work order #"
                      column="ticket"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Customer"
                      column="customer"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Date created"
                      column="created"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="max-w-md px-6 py-4 text-neutral-700">
                        <NoteBody
                          item={item}
                          token={token}
                          editing={editingId === item.id}
                          onEdit={() => setEditingId(item.id)}
                          onSaved={handleSaved}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        <Link
                          href={`/dashboard/work-orders/detail?id=${item.workOrderId}`}
                          className="hover:underline"
                        >
                          {item.ticketNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {item.customerName || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {formatCreated(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination {...paginationProps} position="bottom" />
            </div>
          }
        />
      )}
    </div>
  );
}
