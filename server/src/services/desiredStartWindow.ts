import mongoose from "mongoose";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote } from "../models/mongo/WorkOrderNote";
import { scheduleDesiredWindow } from "./schedule.service";
import { formatLocalDate, storedTicketDateKey } from "../utils/scheduleTime";
import { crewIdStrings } from "../utils/workOrderCrew";

/** Copy the newest note time window onto the work order and place the visit when it changes. */
export async function syncDesiredStartWindow(
  workOrderId: mongoose.Types.ObjectId,
): Promise<string[]> {
  const notes = await WorkOrderNote.find({ workOrderRef: workOrderId })
    .select("desiredStartTime desiredStartBy updatedAt")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  const winner = notes.find((note) => (note.desiredStartTime ?? "").trim());
  const desiredStartTime = winner?.desiredStartTime?.trim() ?? "";
  const desiredStartBy = winner?.desiredStartBy?.trim() ?? "";
  const job = await WorkOrder.findById(workOrderId);
  if (!job) return [];
  const unchanged =
    (job.desiredStartTime ?? "") === desiredStartTime &&
    (job.desiredStartBy ?? "") === desiredStartBy;
  if (unchanged) return [];
  job.desiredStartTime = desiredStartTime;
  job.desiredStartBy = desiredStartBy;
  await job.save();
  if (!desiredStartTime || job.completed) return [];
  const crew = crewIdStrings(job);
  const date = job.scheduledStart
    ? formatLocalDate(job.scheduledStart)
    : storedTicketDateKey(job.date);
  if (crew.length === 0 || !date) return [];
  try {
    const placed = await scheduleDesiredWindow({
      workOrderId: String(job._id),
      userIds: crew,
      date,
      desiredStartTime,
      desiredStartBy,
      estimatedMinutes: job.estimatedMinutes,
    });
    return placed.warnings;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && status < 500) return [(err as Error).message];
    throw err;
  }
}
