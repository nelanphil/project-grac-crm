"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, ChevronRight, Database } from "lucide-react";
import {
  ApiError,
  DatabaseCollectionsResult,
  DatabaseDocumentsPage,
  DatabaseInspectTarget,
  DatabaseOverview,
  getDatabaseCollections,
  getDatabaseDocuments,
  getDatabaseOverviews,
} from "@/lib/api";

const PAGE_SIZE = 25;

function parseTarget(value: string | null): DatabaseInspectTarget | null {
  if (value === "production" || value === "development" || value === "mysql") {
    return value;
  }
  return null;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

function statusClass(status: DatabaseOverview["status"]): string {
  if (status === "connected") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "unavailable") {
    return "bg-neutral-100 text-neutral-500";
  }
  return "bg-amber-100 text-amber-800";
}

function targetTitle(id: DatabaseInspectTarget): string {
  if (id === "production") return "Production";
  if (id === "development") return "Development";
  return "MySQL";
}

function kindLabel(kind: DatabaseOverview["kind"] | DatabaseCollectionsResult["kind"]): string {
  return kind === "mysql" ? "MySQL" : "MongoDB";
}

function noun(kind: DatabaseOverview["kind"] | DatabaseCollectionsResult["kind"]): string {
  return kind === "mysql" ? "tables" : "collections";
}

function cellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "…";
}

function documentColumns(documents: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const doc of documents) {
    for (const key of Object.keys(doc)) keys.add(key);
  }
  const preferred = ["_id", "id"];
  const rest = [...keys].filter((key) => !preferred.includes(key)).sort();
  return [...preferred.filter((key) => keys.has(key)), ...rest];
}

function recordId(doc: Record<string, unknown>): string {
  if (doc._id != null) return String(doc._id);
  if (doc.id != null) return String(doc.id);
  return "";
}

export default function DatabaseHealthSection({
  token,
}: {
  token: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const target = parseTarget(searchParams.get("target"));
  const collection = searchParams.get("collection");

  const [databases, setDatabases] = useState<DatabaseOverview[] | null>(null);
  const [collections, setCollections] = useState<DatabaseCollectionsResult | null>(
    null,
  );
  const [page, setPage] = useState<DatabaseDocumentsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookup, setLookup] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  function replaceNav(next: {
    target?: DatabaseInspectTarget | null;
    collection?: string | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "database");
    params.set("section", "health");
    if (next.target) params.set("target", next.target);
    else params.delete("target");
    if (next.collection) params.set("collection", next.collection);
    else params.delete("collection");
    router.replace(`/dashboard/admin?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(null);

    async function load() {
      try {
        if (!target) {
          const result = await getDatabaseOverviews(token!);
          if (!cancelled) {
            setDatabases(result.databases);
            setCollections(null);
            setPage(null);
          }
          return;
        }
        if (!collection) {
          const result = await getDatabaseCollections(token!, target);
          if (!cancelled) {
            setCollections(result);
            setPage(null);
          }
          return;
        }
        const result = await getDatabaseDocuments(token!, target, collection, {
          limit: PAGE_SIZE,
          skip: 0,
        });
        if (!cancelled) {
          setPage(result);
          setLookup("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Could not load database health.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, target, collection]);

  const columns = useMemo(
    () => (page ? documentColumns(page.documents) : []),
    [page],
  );

  async function goToPage(skip: number) {
    if (!token || !target || !collection) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getDatabaseDocuments(token, target, collection, {
        limit: PAGE_SIZE,
        skip,
      });
      setPage(result);
      setExpanded(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load records.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    if (!token || !target || !collection) return;
    const id = lookup.trim();
    setLoading(true);
    setError(null);
    try {
      const result = await getDatabaseDocuments(token, target, collection, {
        limit: 1,
        skip: 0,
        id: id || undefined,
      });
      setPage(result);
      setExpanded(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not look up that record.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-brand-orange">
            <Activity className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-brand-dark">
              Database Health
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Read-only view of configured Mongo clusters and MySQL. Secrets are
              redacted.
            </p>
            <nav className="mt-3 flex flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => replaceNav({})}
                className="font-medium text-brand-dark hover:text-brand-orange"
              >
                Databases
              </button>
              {target && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
                  <button
                    type="button"
                    onClick={() => replaceNav({ target })}
                    className="font-medium text-brand-dark hover:text-brand-orange"
                  >
                    {targetTitle(target)}
                  </button>
                </>
              )}
              {target && collection && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
                  <span className="font-mono text-neutral-600">{collection}</span>
                </>
              )}
            </nav>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!token && (
          <p className="text-sm text-neutral-500">Sign in to inspect databases.</p>
        )}

        {token && !target && (
          <div className="grid gap-3 sm:grid-cols-3">
            {(databases ?? []).map((db) => {
              const reachable = db.status === "connected";
              return (
                <button
                  key={db.id}
                  type="button"
                  disabled={!reachable}
                  onClick={() => replaceNav({ target: db.id })}
                  className={`rounded-lg border px-4 py-4 text-left transition-colors ${
                    reachable
                      ? "border-neutral-200 hover:border-brand-orange"
                      : "cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-brand-dark">
                      <Database className="h-4 w-4 text-brand-orange" />
                      <span className="font-semibold">{targetTitle(db.id)}</span>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(db.status)}`}
                    >
                      {db.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    {kindLabel(db.kind)}
                    {db.label ? ` · ${db.label}` : ""}
                  </p>
                  {reachable ? (
                    <p className="mt-3 text-sm text-brand-dark">
                      {formatCount(db.collectionCount ?? 0)} {noun(db.kind)}
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-neutral-500">
                      {db.reason ?? "Not available"}
                    </p>
                  )}
                </button>
              );
            })}
            {loading && !databases && (
              <div className="col-span-full text-sm text-neutral-500">
                Loading…
              </div>
            )}
          </div>
        )}

        {token && target && !collection && (
          <div className="space-y-3">
            {collections && (
              <p className="text-sm text-neutral-500">
                {kindLabel(collections.kind)} · {collections.label} ·{" "}
                {formatCount(collections.collections.length)} {noun(collections.kind)}
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {(collections?.collections ?? []).map((item) => (
                    <tr key={item.name} className="border-t border-neutral-100">
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() =>
                            replaceNav({ target, collection: item.name })
                          }
                          className="font-mono text-brand-dark hover:text-brand-orange"
                        >
                          {item.name}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-neutral-600">
                        {formatCount(item.count)}
                      </td>
                    </tr>
                  ))}
                  {loading && !collections && (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={2}>
                        Loading…
                      </td>
                    </tr>
                  )}
                  {collections && collections.collections.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={2}>
                        No {noun(collections.kind)} found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {token && target && collection && (
          <div className="space-y-4">
            <form
              onSubmit={(e) => void onLookup(e)}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="min-w-[12rem] flex-1 text-xs font-medium text-neutral-600">
                {target === "mysql" ? "Primary key" : "_id"}
                <input
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  placeholder="Look up a record"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-brand-dark"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Find
              </button>
              {lookup && (
                <button
                  type="button"
                  onClick={() => {
                    setLookup("");
                    void goToPage(0);
                  }}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-neutral-400"
                >
                  Clear
                </button>
              )}
            </form>

            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {(page?.documents ?? []).map((doc, index) => {
                    const id = recordId(doc) || String(index);
                    const open = expanded === id;
                    return (
                      <Fragment key={id}>
                        <tr className="border-t border-neutral-100">
                          {columns.map((col) => (
                            <td
                              key={col}
                              className="max-w-[16rem] truncate px-3 py-2 font-mono text-xs text-neutral-700"
                            >
                              {cellValue(doc[col])}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : id)}
                              className="text-xs font-medium text-brand-orange hover:underline"
                            >
                              {open ? "Hide" : "JSON"}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-t border-neutral-100">
                            <td
                              colSpan={columns.length + 1}
                              className="bg-neutral-50 px-3 py-3"
                            >
                              <pre className="max-h-80 overflow-auto text-xs text-neutral-700">
                                {JSON.stringify(doc, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {loading && !page && (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={8}>
                        Loading…
                      </td>
                    </tr>
                  )}
                  {page && page.documents.length === 0 && (
                    <tr>
                      <td
                        className="px-4 py-6 text-neutral-500"
                        colSpan={Math.max(columns.length + 1, 1)}
                      >
                        No records.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {page && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
                <span>
                  {formatCount(page.total)} records
                  {page.total > 0
                    ? ` · ${page.skip + 1}–${page.skip + page.documents.length}`
                    : ""}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page.skip <= 0 || loading}
                    onClick={() => void goToPage(Math.max(0, page.skip - PAGE_SIZE))}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={
                      loading || page.skip + page.documents.length >= page.total
                    }
                    onClick={() => void goToPage(page.skip + PAGE_SIZE)}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
