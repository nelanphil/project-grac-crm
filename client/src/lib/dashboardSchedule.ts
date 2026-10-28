import type { TaskItem, WorkOrderListItem } from "@/lib/api";

export function assignedToUser(job: WorkOrderListItem, userId: string): boolean {
  if (job.assignee?._id === userId) return true;
  return typeof job.assignedUserRef === "string" && job.assignedUserRef === userId;
}

/** Same appointments the schedule board draws: anything still placed on a calendar. */
export function isScheduledAppointment(job: WorkOrderListItem): boolean {
  return Boolean(job.scheduledStart);
}

function startMillis(job: WorkOrderListItem): number {
  if (!job.scheduledStart) return Number.MAX_SAFE_INTEGER;
  const time = new Date(job.scheduledStart).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export function dashboardJobs(
  workOrders: WorkOrderListItem[],
  subjectId: string,
): WorkOrderListItem[] {
  return workOrders
    .filter(
      (job) => assignedToUser(job, subjectId) && isScheduledAppointment(job),
    )
    .sort((left, right) => startMillis(left) - startMillis(right));
}

export function dashboardTasks(tasks: TaskItem[], subjectId: string): TaskItem[] {
  return tasks
    .filter(
      (task) =>
        task.scheduledTechnicianId === subjectId && Boolean(task.scheduledStart),
    )
    .sort((left, right) =>
      (left.scheduledStart ?? "").localeCompare(right.scheduledStart ?? ""),
    );
}

function coord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Keep coordinates already resolved on screen when a refresh omits them. */
export function preserveAddressCoords(
  previous: WorkOrderListItem[],
  next: WorkOrderListItem[],
): WorkOrderListItem[] {
  const coords = new Map<string, { lat: number; lng: number }>();
  for (const job of previous) {
    const id = job.address?._id;
    const lat = coord(job.address?.lat);
    const lng = coord(job.address?.lng);
    if (id && lat != null && lng != null) coords.set(id, { lat, lng });
  }
  if (coords.size === 0) return next;
  return next.map((job) => {
    const id = job.address?._id;
    if (!id || !job.address) return job;
    if (coord(job.address.lat) != null && coord(job.address.lng) != null) {
      return job;
    }
    const hit = coords.get(id);
    if (!hit) return job;
    return { ...job, address: { ...job.address, lat: hit.lat, lng: hit.lng } };
  });
}
