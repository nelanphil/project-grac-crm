import mongoose, { Types } from "mongoose";

type CrewDoc = {
  assignedUserRefs?: Array<{ toString(): string }> | null;
  assignedUserRef?: { toString(): string } | null;
};

/** Crew ids, or the single assignee when the crew list has not been written yet. */
export function crewIdStrings(doc: CrewDoc): string[] {
  const listed = (doc.assignedUserRefs ?? [])
    .map((id) => String(id))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const unique = [...new Set(listed)];
  if (unique.length > 0) return unique;
  const single = doc.assignedUserRef ? String(doc.assignedUserRef) : "";
  return mongoose.Types.ObjectId.isValid(single) ? [single] : [];
}

export function assigneeInFilter(
  userIds: Array<string | { toString(): string }>,
): { $or: Array<Record<string, unknown>> } {
  const ids = userIds
    .map((id) => String(id))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  return {
    $or: [
      { assignedUserRefs: { $in: ids } },
      { assignedUserRef: { $in: ids } },
    ],
  };
}

/** Keep assignedUserRef as the first crew member. */
export function applyCrewIds(
  workOrder: {
    assignedUserRef?: Types.ObjectId | null;
    assignedUserRefs?: Types.ObjectId[] | null;
  },
  userIds: string[],
): void {
  const ids = [
    ...new Set(userIds.filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];
  workOrder.assignedUserRefs = ids.map((id) => new mongoose.Types.ObjectId(id));
  workOrder.assignedUserRef = ids[0]
    ? new mongoose.Types.ObjectId(ids[0])
    : null;
}
