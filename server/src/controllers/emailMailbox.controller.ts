import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { EmailAccount } from "../models/mongo/EmailAccount";
import {
  mailboxListQuerySchema,
  mailboxMessageQuerySchema,
} from "../schemas/mailbox.schema";
import {
  getMailboxMessage,
  listMailboxMessages,
  MailboxError,
} from "../services/mailbox.service";

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
    const messages = await listMailboxMessages(
      account,
      parsed.data.folder,
      parsed.data.limit,
    );
    res.json({ folder: parsed.data.folder, messages });
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
    res.json({ folder: parsed.data.folder, message });
  } catch (err) {
    sendMailboxError(res, err);
  }
}
