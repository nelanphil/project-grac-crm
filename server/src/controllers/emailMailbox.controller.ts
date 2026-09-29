import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { EmailAccount } from "../models/mongo/EmailAccount";
import { User } from "../models/mongo/User";
import {
  mailboxAssigneesSchema,
  mailboxListQuerySchema,
  mailboxMessageQuerySchema,
  mailboxReplySchema,
} from "../schemas/mailbox.schema";
import {
  assigneesByMessageKey,
  rememberAssignmentLocations,
  replaceMailboxAssignees,
} from "../services/mailboxAssignment.service";
import { sendMailboxReply } from "../services/mailboxReply.service";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  getMailboxMessage,
  listMailboxMessages,
  MailboxError,
} from "../services/mailbox.service";
import { assignmentMessageKey } from "../utils/mailboxReply";

function sendMailboxError(res: Response, err: unknown): void {
  if (err instanceof MailboxError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Mailbox request failed.";
  console.error("[mailbox] request failed:", message);
  res.status(502).json({ message });
}

async function loadReadableAccount(id: string, res: Response) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "Invalid email account id" });
    return null;
  }
  const account = await EmailAccount.findById(id);
  if (!account) {
    res.status(404).json({ message: "Email account not found" });
    return null;
  }
  if (!account.isActive) {
    res.status(400).json({ message: "Email account is inactive" });
    return null;
  }
  return account;
}

export async function listMailboxMessagesHandler(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = mailboxListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      message: "folder must be inbox or sent",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const account = await loadReadableAccount(String(req.params.accountId), res);
  if (!account) return;

  try {
    const folder = parsed.data.folder;
    const messages = await listMailboxMessages(
      account,
      folder,
      parsed.data.limit,
    );
    const keyed = messages.map((message) => ({
      ...message,
      messageKey: assignmentMessageKey(message.messageId, folder, message.uid),
    }));
    const assigned = await assigneesByMessageKey(
      account._id,
      keyed.map((message) => message.messageKey),
    );
    try {
      await rememberAssignmentLocations(account._id, folder, keyed);
    } catch (err) {
      console.error("[mailbox] could not refresh assignment locations", err);
    }
    res.json({
      folder,
      messages: keyed.map((message) => ({
        ...message,
        assignees: assigned.get(message.messageKey) ?? [],
      })),
    });
  } catch (err) {
    sendMailboxError(res, err);
  }
}

export async function getMailboxMessageHandler(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = mailboxMessageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      message: "folder must be inbox or sent",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const uid = Number(req.params.uid);
  if (!Number.isInteger(uid) || uid < 1) {
    res.status(400).json({ message: "Invalid message id" });
    return;
  }

  const account = await loadReadableAccount(String(req.params.accountId), res);
  if (!account) return;

  try {
    const message = await getMailboxMessage(account, parsed.data.folder, uid);
    const messageKey = assignmentMessageKey(
      message.messageId,
      parsed.data.folder,
      uid,
    );
    const assigned = await assigneesByMessageKey(account._id, [messageKey]);
    res.json({
      folder: parsed.data.folder,
      message: {
        ...message,
        messageKey,
        assignees: assigned.get(messageKey) ?? [],
      },
    });
  } catch (err) {
    sendMailboxError(res, err);
  }
}

function parseUid(value: string, res: Response): number | null {
  const uid = Number(value);
  if (!Number.isInteger(uid) || uid < 1) {
    res.status(400).json({ message: "Invalid message id" });
    return null;
  }
  return uid;
}

export async function replyMailboxMessageHandler(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = mailboxReplySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Check the recipients, subject, and message.",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const uid = parseUid(String(req.params.uid), res);
  if (uid == null) return;

  const account = await loadReadableAccount(String(req.params.accountId), res);
  if (!account) return;

  try {
    const result = await sendMailboxReply({
      account,
      folder: parsed.data.folder,
      uid,
      mode: parsed.data.mode,
      to: parsed.data.to,
      cc: parsed.data.cc,
      bcc: parsed.data.bcc,
      subject: parsed.data.subject,
      html: parsed.data.html,
    });
    res.json(result);
  } catch (err) {
    sendMailboxError(res, err);
  }
}

export async function setMailboxAssigneesHandler(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = mailboxAssigneesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Choose staff to tag on this email.",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const uid = parseUid(String(req.params.uid), res);
  if (uid == null) return;

  const account = await loadReadableAccount(String(req.params.accountId), res);
  if (!account) return;

  try {
    const message = await getMailboxMessage(account, parsed.data.folder, uid);
    const messageKey = assignmentMessageKey(
      message.messageId,
      parsed.data.folder,
      uid,
    );
    const saved = await replaceMailboxAssignees({
      accountId: account._id,
      messageKey,
      folder: parsed.data.folder,
      uid,
      subject: message.subject,
      userIds: parsed.data.userIds,
      actorId: req.user?.id ?? "",
    });

    if (saved.newlyTagged.length > 0 && saved.assignmentId) {
      const actor = req.user?.id
        ? await User.findById(req.user.id)
            .select("first_name last_name email")
            .lean()
        : null;
      const actorName = actor
        ? `${actor.first_name ?? ""} ${actor.last_name ?? ""}`.trim() ||
          actor.email ||
          "Someone"
        : "Someone";
      const subject = message.subject.trim() || "(no subject)";
      logNotificationAsync({
        entityType: "mailbox_message",
        action: "assigned",
        entityId: saved.assignmentId,
        summary: `${actorName} tagged you on “${subject}”`,
        recipientUserIds: saved.newlyTagged,
        metadata: {
          accountId: String(account._id),
          folder: parsed.data.folder,
          uid,
          messageId: messageKey,
        },
        ...actorFromRequest(req.user),
      });
    }

    res.json({ assignees: saved.userRefs, messageKey });
  } catch (err) {
    sendMailboxError(res, err);
  }
}
