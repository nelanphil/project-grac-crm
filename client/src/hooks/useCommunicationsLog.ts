"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getCommunicationsLog,
  type CommunicationLogChannel,
  type CommunicationLogSummary,
  type CommunicationLogThread,
} from "@/lib/api";
import { subscribeDashboardLive } from "@/lib/dashboardLive";
import { MONTH_NAMES, monthBounds } from "@/lib/monthRange";

export type CommunicationsLogFilters = {
  channel: "" | CommunicationLogChannel;
  direction: "" | "inbound" | "outbound";
  repliedOnly: boolean;
  search: string;
};

type Paging = "pages" | "more";

type Query = {
  token: string;
  from: string;
  to: string;
  channel: CommunicationsLogFilters["channel"];
  direction: CommunicationsLogFilters["direction"];
  repliedOnly: boolean;
  search: string;
  pageSize: number;
  paging: Paging;
};

function mergeThreads(
  current: CommunicationLogThread[],
  incoming: CommunicationLogThread[],
): CommunicationLogThread[] {
  const seen = new Set(current.map((thread) => thread.id));
  const next = [...current];
  for (const thread of incoming) {
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    next.push(thread);
  }
  return next;
}

export function useCommunicationsLog(
  token: string,
  options?: { pageSize?: number; paging?: Paging },
) {
  const pageSize = options?.pageSize ?? 25;
  const paging = options?.paging ?? "pages";
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth());
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CommunicationsLogFilters>({
    channel: "",
    direction: "",
    repliedOnly: false,
    search: "",
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [threads, setThreads] = useState<CommunicationLogThread[]>([]);
  const [summary, setSummary] = useState<CommunicationLogSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const requestId = useRef(0);
  const knownIds = useRef<Set<string>>(new Set());
  const pageRef = useRef(1);
  const freshTimers = useRef<number[]>([]);

  const range = useMemo(
    () => monthBounds(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const isCurrentMonth =
    viewYear === now.getFullYear() && viewMonth === now.getMonth();
  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  const queryRef = useRef<Query>({
    token,
    from: range.from,
    to: range.to,
    channel: filters.channel,
    direction: filters.direction,
    repliedOnly: filters.repliedOnly,
    search: debouncedSearch,
    pageSize,
    paging,
  });

  useEffect(() => {
    queryRef.current = {
      token,
      from: range.from,
      to: range.to,
      channel: filters.channel,
      direction: filters.direction,
      repliedOnly: filters.repliedOnly,
      search: debouncedSearch,
      pageSize,
      paging,
    };
  }, [
    token,
    range.from,
    range.to,
    filters.channel,
    filters.direction,
    filters.repliedOnly,
    debouncedSearch,
    pageSize,
    paging,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(filters.search),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    const timers = freshTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  function markFresh(ids: string[]) {
    if (ids.length === 0) return;
    setFreshIds((current) => [...ids, ...current].slice(0, 8));
    const timer = window.setTimeout(() => {
      setFreshIds((current) => current.filter((id) => !ids.includes(id)));
    }, 4000);
    freshTimers.current.push(timer);
  }

  function applyThreads(
    incoming: CommunicationLogThread[],
    mode: "replace" | "append",
    silent: boolean,
  ) {
    const previous = knownIds.current;
    const fresh = silent
      ? incoming.filter((thread) => !previous.has(thread.id)).map((thread) => thread.id)
      : [];
    setThreads((current) => {
      const next = mode === "append" ? mergeThreads(current, incoming) : incoming;
      knownIds.current = new Set(next.map((thread) => thread.id));
      return next;
    });
    markFresh(fresh);
  }

  useEffect(() => {
    const id = ++requestId.current;
    const mode = paging === "more" && page > 1 ? "append" : "replace";
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setError(null);
      if (mode === "append") setLoadingMore(true);
      else {
        setLoading(true);
        setThreads([]);
      }
    });

    getCommunicationsLog(token, {
      from: range.from,
      to: range.to,
      channel: filters.channel || undefined,
      direction: filters.direction || undefined,
      repliedOnly: filters.repliedOnly || undefined,
      search: debouncedSearch || undefined,
      page,
      pageSize,
    })
      .then((res) => {
        if (cancelled || id !== requestId.current) return;
        applyThreads(res.threads, mode, false);
        setSummary(res.summary);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load the communications log.",
        );
      })
      .finally(() => {
        if (cancelled || id !== requestId.current) return;
        setLoading(false);
        setLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
    // applyThreads closes over markFresh; both are recreated each render and
    // only touch refs plus setState, so the fetch effect lists the query inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    range.from,
    range.to,
    page,
    pageSize,
    paging,
    filters.channel,
    filters.direction,
    filters.repliedOnly,
    debouncedSearch,
  ]);

  useEffect(() => {
    if (!token || !isCurrentMonth) return;
    return subscribeDashboardLive(token, () => {
      const query = queryRef.current;
      const id = ++requestId.current;
      const size =
        query.paging === "more"
          ? Math.min(100, Math.max(query.pageSize, pageRef.current * query.pageSize))
          : query.pageSize;
      const nextPage = query.paging === "more" ? 1 : pageRef.current;
      getCommunicationsLog(query.token, {
        from: query.from,
        to: query.to,
        channel: query.channel || undefined,
        direction: query.direction || undefined,
        repliedOnly: query.repliedOnly || undefined,
        search: query.search || undefined,
        page: nextPage,
        pageSize: size,
      })
        .then((res) => {
          if (id !== requestId.current) return;
          applyThreads(res.threads, "replace", true);
          setSummary(res.summary);
          setTotal(res.total);
          setLoading(false);
          setLoadingMore(false);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setLoading(false);
          setLoadingMore(false);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isCurrentMonth]);

  function resetPage() {
    pageRef.current = 1;
    setPage(1);
  }

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    resetPage();
  }

  function shiftYear(delta: number) {
    setViewYear((year) => year + delta);
    resetPage();
  }

  function goToCurrentMonth() {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    resetPage();
  }

  function updateFilters(patch: Partial<CommunicationsLogFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    resetPage();
  }

  function loadMore() {
    if (paging !== "more" || loading || loadingMore || threads.length >= total) {
      return;
    }
    setPage((current) => current + 1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    viewYear,
    viewMonth,
    monthLabel,
    isCurrentMonth,
    live: isCurrentMonth ? ("open" as const) : ("off" as const),
    shiftMonth,
    shiftYear,
    goToCurrentMonth,
    filters,
    updateFilters,
    threads,
    summary,
    total,
    page,
    pageSize,
    totalPages,
    setPage,
    loadMore,
    hasMore: threads.length < total,
    loading,
    loadingMore,
    error,
    freshIds,
  };
}
