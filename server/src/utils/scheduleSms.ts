import { SMS_BODY_MAX } from "../schemas/messageTemplate.schema";
import { SCHEDULE_TIMEZONE, localDateToUtc } from "./scheduleTime";

const COMPANY_NAME = "Generator Maintenance of Florida";

export type ScheduleSmsJob = {
  scheduledStart: Date | string;
  contactName?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
};

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

function formatJobBlock(job: ScheduleSmsJob, when: Date): string {
  const place = [job.street, job.city]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
  const lines = [
    formatClock(when),
    job.contactName?.trim() ?? "",
    job.phone?.trim() ?? "",
    place,
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
      return when ? { when, block: formatJobBlock(job, when) } : null;
    })
    .filter((job): job is { when: Date; block: string } => job !== null)
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .map((job) => job.block);

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
