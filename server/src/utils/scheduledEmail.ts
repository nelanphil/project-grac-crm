export const MIN_SCHEDULE_LEAD_MS = 60_000;

export class ScheduledAtError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ScheduledAtError";
  }
}

export function parseFutureScheduledAt(raw: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ScheduledAtError("Invalid scheduledAt");
  }
  if (date.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
    throw new ScheduledAtError(
      "Scheduled time must be at least 1 minute in the future",
    );
  }
  return date;
}
