import { SMS_BODY_MAX } from "../schemas/messageTemplate.schema";
import { SCHEDULE_TIMEZONE, localDateToUtc } from "./scheduleTime";

const COMPANY_NAME = "Generator Maintenance of Florida";

const NOTE_MAX = 160;

export type ScheduleSmsJob = {
  scheduledStart: Date | string;
  /** Omitted stops are appointments. */
  kind?: "task";
  contactName?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  notes?: string[] | null;
  title?: string | null;
  description?: string | null;
};

export function formatScheduleClock(date: Date | string): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return formatClock(value);
}

function formatScheduleDateLabel(localDate: string): string {
  const noon = localDateToUtc(localDate, "12:00");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(noon)
    .replace(/\u202f/g, " ");
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\u202f/g, " ");
}

function jobInstant(job: ScheduleSmsJob): Date | null {
  const value =
    job.scheduledStart instanceof Date
      ? job.scheduledStart
      : new Date(job.scheduledStart);
  return Number.isNaN(value.getTime()) ? null : value;
}

function capSmsText(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > NOTE_MAX ? `${flat.slice(0, NOTE_MAX - 1)}…` : flat;
}

function smsNoteLine(note: string): string | null {
  const body = capSmsText(note);
  return body ? `Note: ${body}` : null;
}

function formatStopBlock(job: ScheduleSmsJob, index: number): string {
  const number = index + 1;
  if (job.kind === "task") {
    const title = job.title?.replace(/\s+/g, " ").trim() ?? "";
    const heading = title ? `${number}. Task: ${title}` : `${number}. Task`;
    const description = capSmsText(job.description ?? "");
    return description ? `${heading}\n${description}` : heading;
  }

  const place = [job.street, job.city]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
  const noteLines = (job.notes ?? [])
    .map((note) => smsNoteLine(note))
    .filter((line): line is string => line !== null);
  const name = job.contactName?.trim() ?? "";
  const lines = [
    name ? `${number}. ${name}` : `${number}.`,
    job.phone?.trim() ?? "",
    place,
    ...noteLines,
  ].filter(Boolean);
  return lines.join("\n");
}

function assemble(
  header: string,
  blocks: string[],
  note: string | null,
  footer: string,
): string {
  const parts = [header];
  if (blocks.length === 0 && !note) {
    parts.push("No appointments.");
  } else {
    parts.push(...blocks);
    if (note) parts.push(note);
  }
  parts.push(footer);
  return parts.join("\n\n");
}

/**
 * One technician's day, capped at the SMS body limit. Job blocks that do not
 * fit are counted above the app link, which is always kept intact.
 */
export function formatScheduleSms(opts: {
  date: string;
  technicianName: string;
  jobs: ScheduleSmsJob[];
  appUrl: string;
}): string {
  const technician = opts.technicianName.trim() || "Technician";
  const header = [
    COMPANY_NAME,
    formatScheduleDateLabel(opts.date),
    `${technician} schedule:`,
  ].join("\n");
  const footer = `View your schedule:\n${opts.appUrl.trim()}`;
  const blocks = opts.jobs
    .map((job) => {
      const when = jobInstant(job);
      return when ? { when, job } : null;
    })
    .filter((job): job is { when: Date; job: ScheduleSmsJob } => job !== null)
    .sort((a, b) => {
      const delta = a.when.getTime() - b.when.getTime();
      if (delta !== 0) return delta;
      const rank = (job: ScheduleSmsJob) => (job.kind === "task" ? 1 : 0);
      return rank(a.job) - rank(b.job);
    })
    .map((job, index) => formatStopBlock(job.job, index));

  if (blocks.length === 0) {
    return assemble(header, [], null, footer);
  }

  const full = assemble(header, blocks, null, footer);
  if (full.length <= SMS_BODY_MAX) return full;

  const kept: string[] = [];
  for (const block of blocks) {
    const omitted = blocks.length - (kept.length + 1);
    const candidate = assemble(
      header,
      [...kept, block],
      omitted > 0 ? `…and ${omitted} more` : null,
      footer,
    );
    if (candidate.length > SMS_BODY_MAX) break;
    kept.push(block);
  }

  const omitted = blocks.length - kept.length;
  return assemble(header, kept, `…and ${omitted} more`, footer);
}
