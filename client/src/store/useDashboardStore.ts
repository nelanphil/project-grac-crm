import { create } from "zustand";
import {
  API_URL,
  ApiError,
  getRecentWorkOrderNotes,
  getReminders,
  getScheduleRoute,
  getScheduleStaff,
  type RecentWorkOrderNote,
  type ReminderListItem,
  type ScheduleRouteStop,
  type WorkOrderListItem,
} from "@/lib/api";
import {
  loadUnreadInbox,
  markInboxPreviewRead,
  type InboxPreview,
} from "@/lib/dashboardInbox";
import {
  dashboardJobs,
  preserveAddressCoords,
} from "@/lib/dashboardSchedule";

const REMINDER_PREVIEW = 4;

export type ScheduleScope = {
  subjectId: string;
  weekStart: string;
  weekEnd: string;
  focusDate: string;
  whose: string;
};

type Slice = "reminders" | "notes" | "inbox" | "schedule";

const sliceSeq: Record<Slice, number> = {
  reminders: 0,
  notes: 0,
  inbox: 0,
  schedule: 0,
};

let liveAbort: AbortController | null = null;
let liveToken: string | null = null;
let refreshing = false;
let refreshQueued = false;

function beginSlice(slice: Slice): number {
  sliceSeq[slice] += 1;
  return sliceSeq[slice];
}

function sliceCurrent(slice: Slice, seq: number): boolean {
  return sliceSeq[slice] === seq;
}

function scopeKey(scope: ScheduleScope): string {
  return `${scope.subjectId}|${scope.weekStart}|${scope.weekEnd}|${scope.focusDate}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDashboardEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: () => void,
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
        if (frame.split("\n").some((line) => line.startsWith("data:"))) {
          onEvent();
        }
        splitAt = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface DashboardStore {
  sessionToken: string | null;
  canSeeInbox: boolean;
  reminders: ReminderListItem[] | null;
  reminderTotal: number;
  reminderError: string | null;
  notes: RecentWorkOrderNote[] | null;
  notesError: string | null;
  inbox: InboxPreview[] | null;
  inboxError: string | null;
  jobs: WorkOrderListItem[] | null;
  scheduleLoading: boolean;
  scheduleError: string | null;
  routeStops: ScheduleRouteStop[];
  routePolyline: string | undefined;
  scope: ScheduleScope | null;
  scheduleBusy: boolean;
  setCanSeeInbox: (value: boolean) => void;
  setScheduleBusy: (busy: boolean) => void;
  setScheduleFocus: (focusDate: string) => void;
  loadBriefing: (token: string) => void;
  loadInbox: (token: string) => void;
  markInboxRead: (token: string, id: string) => Promise<void>;
  loadSchedule: (token: string, scope: ScheduleScope) => void;
  clearSchedule: () => void;
  updateJobs: (
    fn: (jobs: WorkOrderListItem[]) => WorkOrderListItem[],
  ) => void;
  setRoute: (stops: ScheduleRouteStop[], polyline: string | undefined) => void;
  clearRoute: () => void;
  refresh: (token: string) => Promise<void>;
  connect: (token: string) => void;
  disconnect: () => void;
}

function resetLive(): void {
  liveAbort?.abort();
  liveAbort = null;
  liveToken = null;
  refreshQueued = false;
}

async function runLive(token: string, signal: AbortSignal): Promise<void> {
  let refreshOnOpen = false;
  let delay = 1_000;
  while (!signal.aborted) {
    try {
      const res = await fetch(`${API_URL}/dashboard/live`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal,
      });
      if (signal.aborted) return;
      if (!res.ok || !res.body) throw new Error("dashboard live closed");
      if (refreshOnOpen) void useDashboardStore.getState().refresh(token);
      refreshOnOpen = true;
      delay = 1_000;
      await readDashboardEvents(
        res.body,
        () => {
          void useDashboardStore.getState().refresh(token);
        },
        signal,
      );
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  sessionToken: null,
  canSeeInbox: false,
  reminders: null,
  reminderTotal: 0,
  reminderError: null,
  notes: null,
  notesError: null,
  inbox: null,
  inboxError: null,
  jobs: null,
  scheduleLoading: true,
  scheduleError: null,
  routeStops: [],
  routePolyline: undefined,
  scope: null,
  scheduleBusy: false,

  setCanSeeInbox: (canSeeInbox) => set({ canSeeInbox }),

  setScheduleBusy: (scheduleBusy) => {
    set({ scheduleBusy });
    if (!scheduleBusy && refreshQueued && liveToken) {
      refreshQueued = false;
      void get().refresh(liveToken);
    }
  },

  setScheduleFocus: (focusDate) => {
    const scope = get().scope;
    if (!scope || scope.focusDate === focusDate) return;
    set({ scope: { ...scope, focusDate } });
  },

  loadBriefing: (token) => {
    if (get().sessionToken !== token) {
      set({
        sessionToken: token,
        reminders: null,
        reminderTotal: 0,
        reminderError: null,
        notes: null,
        notesError: null,
        inbox: null,
        inboxError: null,
      });
    }
    const reminderSeq = beginSlice("reminders");
    const noteSeq = beginSlice("notes");
    getReminders(token, {
      page: 1,
      pageSize: 50,
      sort: "created",
      dir: "desc",
    })
      .then((result) => {
        if (!sliceCurrent("reminders", reminderSeq)) return;
        set({
          reminders: result.reminders.slice(0, REMINDER_PREVIEW),
          reminderTotal: result.total,
          reminderError: null,
        });
      })
      .catch((err: unknown) => {
        if (!sliceCurrent("reminders", reminderSeq)) return;
        set({
          reminders: [],
          reminderError: errorMessage(err, "Could not load reminders"),
        });
      });
    getRecentWorkOrderNotes(token)
      .then((result) => {
        if (!sliceCurrent("notes", noteSeq)) return;
        set({ notes: result.notes, notesError: null });
      })
      .catch((err: unknown) => {
        if (!sliceCurrent("notes", noteSeq)) return;
        if (err instanceof ApiError && err.status === 403) {
          set({ notes: [], notesError: null });
          return;
        }
        set({
          notes: [],
          notesError: errorMessage(err, "Could not load recent notes"),
        });
      });
  },

  loadInbox: (token) => {
    const seq = beginSlice("inbox");
    set({ inboxError: null });
    loadUnreadInbox(token)
      .then((inbox) => {
        if (!sliceCurrent("inbox", seq)) return;
        set({ inbox, inboxError: null });
      })
      .catch((err: unknown) => {
        if (!sliceCurrent("inbox", seq)) return;
        set({
          inbox: [],
          inboxError: errorMessage(err, "Could not load inbox"),
        });
      });
  },

  markInboxRead: async (token, id) => {
    const item = get().inbox?.find((row) => row.id === id);
    if (!item) return;
    try {
      await markInboxPreviewRead(token, item);
      beginSlice("inbox");
      set((state) => ({
        inbox: state.inbox?.filter((row) => row.id !== id) ?? null,
        inboxError: null,
      }));
    } catch (err: unknown) {
      set({
        inboxError: errorMessage(err, "Could not mark message read"),
      });
    }
  },

  loadSchedule: (token, scope) => {
    const seq = beginSlice("schedule");
    set({
      scope,
      scheduleLoading: true,
      scheduleError: null,
    });
    getScheduleStaff(token, scope.weekStart, scope.weekEnd, scope.subjectId)
      .then(({ workOrders }) => {
        if (!sliceCurrent("schedule", seq)) return;
        if (!get().scope || scopeKey(get().scope!) !== scopeKey(scope)) return;
        set({
          jobs: preserveAddressCoords(
            get().jobs ?? [],
            dashboardJobs(workOrders, scope.subjectId),
          ),
          scheduleLoading: false,
          scheduleError: null,
        });
      })
      .catch((err: unknown) => {
        if (!sliceCurrent("schedule", seq)) return;
        if (err instanceof ApiError && err.status === 403) {
          set({
            scheduleLoading: false,
            scheduleError: "This account cannot read jobs.",
          });
          return;
        }
        set({
          scheduleLoading: false,
          scheduleError: errorMessage(
            err,
            `Failed to load ${scope.whose} schedule.`,
          ),
        });
      });
  },

  clearSchedule: () => {
    beginSlice("schedule");
    set({
      jobs: [],
      scheduleLoading: false,
      scheduleError: null,
      routeStops: [],
      routePolyline: undefined,
      scope: null,
    });
  },

  updateJobs: (fn) => {
    const jobs = get().jobs;
    if (!jobs) return;
    set({ jobs: fn(jobs) });
  },

  setRoute: (routeStops, routePolyline) => set({ routeStops, routePolyline }),

  clearRoute: () => set({ routeStops: [], routePolyline: undefined }),

  refresh: async (token) => {
    if (get().scheduleBusy) {
      refreshQueued = true;
      return;
    }
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    const { canSeeInbox, scope, scheduleBusy } = get();
    const includeSchedule = Boolean(scope?.subjectId) && !scheduleBusy;
    const capturedScope = scope;
    const reminderSeq = beginSlice("reminders");
    const noteSeq = beginSlice("notes");
    const inboxSeq = canSeeInbox ? beginSlice("inbox") : 0;
    const scheduleId = includeSchedule ? beginSlice("schedule") : 0;
    try {
      const [remindersResult, notesResult, inboxResult, jobsResult, routeResult] =
        await Promise.all([
          getReminders(token, {
            page: 1,
            pageSize: 50,
            sort: "created",
            dir: "desc",
          })
            .then((result) => ({
              reminders: result.reminders.slice(0, REMINDER_PREVIEW),
              reminderTotal: result.total,
              reminderError: null as string | null,
            }))
            .catch(() => null),
          getRecentWorkOrderNotes(token)
            .then((result) => ({
              notes: result.notes,
              notesError: null as string | null,
            }))
            .catch((err: unknown) => {
              if (err instanceof ApiError && err.status === 403) {
                return { notes: [] as RecentWorkOrderNote[], notesError: null };
              }
              return null;
            }),
          canSeeInbox
            ? loadUnreadInbox(token)
                .then((inbox) => ({ inbox, inboxError: null as string | null }))
                .catch(() => null)
            : Promise.resolve(null),
          includeSchedule && capturedScope
            ? getScheduleStaff(
                token,
                capturedScope.weekStart,
                capturedScope.weekEnd,
                capturedScope.subjectId,
              )
                .then(({ workOrders }) =>
                  dashboardJobs(workOrders, capturedScope.subjectId),
                )
                .catch(() => null)
            : Promise.resolve(null),
          includeSchedule && capturedScope
            ? getScheduleRoute(
                token,
                capturedScope.subjectId,
                capturedScope.focusDate,
              )
                .then((result) => ({
                  routeStops: result.stops,
                  routePolyline: result.route?.encodedPolyline,
                }))
                .catch(() => null)
            : Promise.resolve(null),
        ]);

      const patch: Partial<DashboardStore> = {};
      if (sliceCurrent("reminders", reminderSeq) && remindersResult) {
        patch.reminders = remindersResult.reminders;
        patch.reminderTotal = remindersResult.reminderTotal;
        patch.reminderError = remindersResult.reminderError;
      }
      if (sliceCurrent("notes", noteSeq) && notesResult) {
        patch.notes = notesResult.notes;
        patch.notesError = notesResult.notesError;
      }
      if (canSeeInbox && sliceCurrent("inbox", inboxSeq) && inboxResult) {
        patch.inbox = inboxResult.inbox;
        patch.inboxError = inboxResult.inboxError;
      }
      const scopeStill =
        includeSchedule &&
        capturedScope &&
        sliceCurrent("schedule", scheduleId) &&
        get().scope != null &&
        scopeKey(get().scope!) === scopeKey(capturedScope);
      const queuedBeforeApply = refreshQueued;
      if (scopeStill && !get().scheduleBusy) {
        if (jobsResult) {
          patch.jobs = preserveAddressCoords(get().jobs ?? [], jobsResult);
        }
        if (routeResult) {
          patch.routeStops = routeResult.routeStops;
          patch.routePolyline = routeResult.routePolyline;
        }
      } else if (includeSchedule && get().scheduleBusy) {
        refreshQueued = true;
      }
      if (!queuedBeforeApply && Object.keys(patch).length > 0) set(patch);
    } finally {
      refreshing = false;
      if (refreshQueued && liveToken && !get().scheduleBusy) {
        refreshQueued = false;
        void get().refresh(liveToken);
      }
    }
  },

  connect: (token) => {
    if (liveToken === token && liveAbort) return;
    resetLive();
    liveToken = token;
    liveAbort = new AbortController();
    void runLive(token, liveAbort.signal);
  },

  disconnect: () => {
    resetLive();
  },
}));
