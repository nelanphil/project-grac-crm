import mongoose, { Types } from "mongoose";
import { MailboxAssignment } from "../models/mongo/MailboxAssignment";
import { User, activeUserFilter } from "../models/mongo/User";
import { MailboxError, MailboxFolder } from "./mailbox.service";
import { newlyTaggedUserIds } from "../utils/mailboxReply";

export async function assigneesByMessageKey(
  accountId: Types.ObjectId,
  messageKeys: string[],
): Promise<Map<string, string[]>> {
  if (messageKeys.length === 0) return new Map();
  const rows = await MailboxAssignment.find({
    emailAccountRef: accountId,
    messageId: { $in: messageKeys },
  })
    .select("messageId userRefs")
    .lean();
  return new Map(
    rows.map((row) => [
      row.messageId,
      (row.userRefs ?? []).map((id) => String(id)),
    ]),
  );
}

export async function rememberAssignmentLocations(
  accountId: Types.ObjectId,
  folder: MailboxFolder,
  messages: { messageKey: string; uid: number; subject: string }[],
): Promise<void> {
  if (messages.length === 0) return;
  await MailboxAssignment.bulkWrite(
    messages.map((message) => ({
      updateOne: {
        filter: {
          emailAccountRef: accountId,
          messageId: message.messageKey,
        },
        update: {
          $set: { folder, uid: message.uid, subject: message.subject },
        },
      },
    })),
  );
}

export async function replaceMailboxAssignees(input: {
  accountId: Types.ObjectId;
  messageKey: string;
  folder: MailboxFolder;
  uid: number;
  subject: string;
  userIds: string[];
  actorId: string;
}): Promise<{
  assignmentId: string;
  userRefs: string[];
  newlyTagged: string[];
}> {
  const unique = [
    ...new Set(input.userIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (unique.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new MailboxError("One or more staff members were not found.", 400);
  }
  const ids = unique.map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length > 0) {
    const found = await User.find({
      _id: { $in: ids },
      ...activeUserFilter,
      userType: { $ne: "customer" },
    }).select("_id");
    if (found.length !== ids.length) {
      throw new MailboxError("One or more staff members were not found.", 400);
    }
  }

  const existing = await MailboxAssignment.findOne({
    emailAccountRef: input.accountId,
    messageId: input.messageKey,
  }).select("userRefs");
  const previous = (existing?.userRefs ?? []).map((id) => String(id));
  const doc = await MailboxAssignment.findOneAndUpdate(
    { emailAccountRef: input.accountId, messageId: input.messageKey },
    {
      $set: {
        folder: input.folder,
        uid: input.uid,
        subject: input.subject,
        userRefs: ids,
      },
      $setOnInsert: {
        emailAccountRef: input.accountId,
        messageId: input.messageKey,
      },
    },
    { upsert: true, new: true },
  );
  const current = (doc?.userRefs ?? []).map((id) => String(id));
  return {
    assignmentId: doc ? String(doc._id) : "",
    userRefs: current,
    newlyTagged: newlyTaggedUserIds(previous, current, input.actorId),
  };
}
