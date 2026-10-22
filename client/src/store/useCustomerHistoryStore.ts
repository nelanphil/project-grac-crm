import { create } from "zustand";
import {
  API_URL,
  ApiError,
  getAllCustomerActivity,
  getCustomerActivity,
  type CustomerActivityItem,
} from "@/lib/api";

export const ALL_HISTORY_KEY = "all";

export type HistoryLiveState = "off" | "connecting" | "open" | "retrying";

export type HistoryFilters = {
  categories: string[];
  actorKind: string | null;
};

type Bucket = {
  byId: Record<string, CustomerActivityItem>;
  order: string[];
  nextCursor: string | null;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  live: HistoryLiveState;
  unseenIds: string[];
  watching: boolean;
};

type HistoryStore = {
  byCustomer: Record<string, Bucket>;
  filters: HistoryFilters;
  loadInitial: (token: string, customerId: string) => void;
  loadMore: (token: string, customerId: string) => void;
  upsertActivity: (
    customerId: string,
    item: CustomerActivityItem,
    opts?: { unseen?: boolean },
  ) => void;
  upsertMany: (customerId: string, items: CustomerActivityItem[]) => void;
  markSeen: (customerId: string) => void;
  setWatching: (customerId: string, watching: boolean) => void;
  setFilters: (token: string, customerId: string, filters: HistoryFilters) => void;
  connect: (token: string, customerId: string) => void;
  disconnect: (customerId: string) => void;
};

const seq: Record<string, number> = {};
const moreSeq: Record<string, number> = {};

type LiveConn = {
  token: string;
  refs: number;
  abort: AbortController;
};

const live = new Map<string, LiveConn>();

function begin(customerId: string): number {
  seq[customerId] = (seq[customerId] ?? 0) + 1;
  return seq[customerId];
}

function current(customerId: string, value: number): boolean {
  return seq[customerId] === value;
}

function emptyBucket(): Bucket {
  return {
    byId: {},
    order: [],
    nextCursor: null,
    loaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    live: "off",
    unseenIds: [],
    watching: false,
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function compareItems(a: CustomerActivityItem, b: CustomerActivityItem): number {
  if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

function sortedOrder(byId: Record<string, CustomerActivityItem>): string[] {
  return Object.values(byId)
    .sort(compareItems)
    .map((item) => item.id);
}

function putItem(
  bucket: Bucket,
  item: CustomerActivityItem,
  unseen: boolean,
): Bucket {
  const existed = Boolean(bucket.byId[item.id]);
  const byId = { ...bucket.byId, [item.id]: item };
  const unseenIds =
    unseen && !existed && !bucket.watching
      ? [...bucket.unseenIds, item.id]
      : bucket.unseenIds;
  return {
    ...bucket,
    byId,
    order: sortedOrder(byId),
    unseenIds,
  };
}

function mergePage(
  bucket: Bucket,
  page: CustomerActivityItem[],
  nextCursor: string | null,
): Pick<Bucket, "byId" | "order" | "nextCursor"> {
  const byId = { ...bucket.byId };
  const pageIds = new Set<string>();
  for (const item of page) {
    byId[item.id] = item;
    pageIds.add(item.id);
  }
  const newest = page[0]?.createdAt;
  for (const id of bucket.order) {
    if (pageIds.has(id)) continue;
    const item = byId[id];
    if (!item || !newest || item.createdAt < newest) {
      delete byId[id];
    }
  }
  return { byId, order: sortedOrder(byId), nextCursor };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function patchBucket(
  byCustomer: Record<string, Bucket>,
  customerId: string,
  patch: Partial<Bucket> | ((bucket: Bucket) => Bucket),
): Record<string, Bucket> {
  const currentBucket = byCustomer[customerId] ?? emptyBucket();
  const next =
    typeof patch === "function" ? patch(currentBucket) : { ...currentBucket, ...patch };
  return { ...byCustomer, [customerId]: next };
}

async function readActivityEvents(
  body: ReadableStream<Uint8Array>,
  onItem: (item: CustomerActivityItem) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let splitAt = buffer.indexOf("\n\n");
      while (splitAt !== -1) {
        const frame = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (eventName === "activity" && dataLines.length > 0) {
          try {
            onItem(JSON.parse(dataLines.join("\n")) as CustomerActivityItem);
          } catch {
            // Ignore a malformed frame and keep the stream.
          }
        }
        splitAt = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function fetchActivity(
  token: string,
  customerId: string,
  opts: {
    before?: string;
    after?: string;
    limit?: number;
    categories?: string[];
    actorKind?: string | null;
  },
) {
  if (customerId === ALL_HISTORY_KEY) return getAllCustomerActivity(token, opts);
  return getCustomerActivity(token, customerId, opts);
}

function livePath(customerId: string): string {
  if (customerId === ALL_HISTORY_KEY) return "/customer-activity/live";
  return `/customers/${customerId}/activity/live`;
}

async function fillGap(token: string, customerId: string): Promise<void> {
  const bucket = useCustomerHistoryStore.getState().byCustomer[customerId];
  const newest = bucket?.order[0];
  if (!bucket?.loaded || !newest) return;
  const filters = useCustomerHistoryStore.getState().filters;
  const result = await fetchActivity(token, customerId, {
    after: newest,
    limit: 100,
    categories: filters.categories,
    actorKind: filters.actorKind,
  });
  if (result.items.length > 0) {
    useCustomerHistoryStore.getState().upsertMany(customerId, result.items);
  }
}

async function runLive(
  token: string,
  customerId: string,
  signal: AbortSignal,
): Promise<void> {
  let opened = false;
  let delay = 1_000;
  const setLive = (liveState: HistoryLiveState) => {
    useCustomerHistoryStore.setState((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, { live: liveState }),
    }));
  };
  while (!signal.aborted) {
    try {
      setLive(opened ? "retrying" : "connecting");
      const res = await fetch(
        `${API_URL}${livePath(customerId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal,
        },
      );
      if (signal.aborted) return;
      if (!res.ok || !res.body) throw new Error("history live closed");
      if (opened) {
        try {
          await fillGap(token, customerId);
        } catch {
          // The next event still arrives on the stream.
        }
      }
      opened = true;
      delay = 1_000;
      setLive("open");
      await readActivityEvents(
        res.body,
        (item) => {
          useCustomerHistoryStore.getState().upsertActivity(customerId, item, {
            unseen: true,
          });
        },
        signal,
      );
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    setLive("retrying");
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
}

export const useCustomerHistoryStore = create<HistoryStore>((set, get) => ({
  byCustomer: {},
  filters: { categories: [], actorKind: null },

  loadInitial: (token, customerId) => {
    const request = begin(customerId);
    const filters = get().filters;
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, {
        loading: true,
        error: null,
      }),
    }));
    fetchActivity(token, customerId, {
      limit: 40,
      categories: filters.categories,
      actorKind: filters.actorKind,
    })
      .then((result) => {
        if (!current(customerId, request)) return;
        set((state) => ({
          byCustomer: patchBucket(state.byCustomer, customerId, (bucket) => {
            const merged = mergePage(bucket, result.items, result.nextCursor);
            return {
              ...bucket,
              ...merged,
              loaded: true,
              loading: false,
              error: null,
            };
          }),
        }));
      })
      .catch((err: unknown) => {
        if (!current(customerId, request)) return;
        set((state) => ({
          byCustomer: patchBucket(state.byCustomer, customerId, {
            loading: false,
            loaded: true,
            error: errorMessage(err, "Could not load history"),
          }),
        }));
      });
  },

  loadMore: (token, customerId) => {
    const bucket = get().byCustomer[customerId];
    if (!bucket?.nextCursor || bucket.loadingMore) return;
    const request = seq[customerId] ?? 0;
    moreSeq[customerId] = (moreSeq[customerId] ?? 0) + 1;
    const more = moreSeq[customerId];
    const filters = get().filters;
    const before = bucket.nextCursor;
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, {
        loadingMore: true,
      }),
    }));
    fetchActivity(token, customerId, {
      before,
      limit: 40,
      categories: filters.categories,
      actorKind: filters.actorKind,
    })
      .then((result) => {
        if (!current(customerId, request) || moreSeq[customerId] !== more) return;
        set((state) => ({
          byCustomer: patchBucket(state.byCustomer, customerId, (currentBucket) => {
            const byId = { ...currentBucket.byId };
            for (const item of result.items) byId[item.id] = item;
            return {
              ...currentBucket,
              byId,
              order: sortedOrder(byId),
              nextCursor: result.nextCursor,
              loadingMore: false,
            };
          }),
        }));
      })
      .catch((err: unknown) => {
        if (!current(customerId, request) || moreSeq[customerId] !== more) return;
        set((state) => ({
          byCustomer: patchBucket(state.byCustomer, customerId, {
            loadingMore: false,
            error: errorMessage(err, "Could not load older history"),
          }),
        }));
      });
  },

  upsertActivity: (customerId, item, opts) => {
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, (bucket) =>
        putItem(bucket, item, Boolean(opts?.unseen)),
      ),
    }));
  },

  upsertMany: (customerId, items) => {
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, (bucket) => {
        let next = bucket;
        for (const item of items) next = putItem(next, item, true);
        return next;
      }),
    }));
  },

  markSeen: (customerId) => {
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, { unseenIds: [] }),
    }));
  },

  setWatching: (customerId, watching) => {
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, (bucket) => ({
        ...bucket,
        watching,
        unseenIds: watching ? [] : bucket.unseenIds,
      })),
    }));
  },

  setFilters: (token, customerId, filters) => {
    set({ filters });
    get().loadInitial(token, customerId);
  },

  connect: (token, customerId) => {
    const existing = live.get(customerId);
    if (existing && existing.token === token) {
      existing.refs += 1;
      return;
    }
    existing?.abort.abort();
    const abort = new AbortController();
    live.set(customerId, { token, refs: 1, abort });
    void runLive(token, customerId, abort.signal);
  },

  disconnect: (customerId) => {
    const existing = live.get(customerId);
    if (!existing) return;
    existing.refs -= 1;
    if (existing.refs > 0) return;
    existing.abort.abort();
    live.delete(customerId);
    set((state) => ({
      byCustomer: patchBucket(state.byCustomer, customerId, { live: "off" }),
    }));
  },
}));
