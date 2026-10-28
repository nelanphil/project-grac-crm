import { Types } from "mongoose";
import { EmailAccount, IEmailAccount } from "../models/mongo/EmailAccount";
import {
  EmailCommunication,
  IEmailAttachment,
} from "../models/mongo/EmailCommunication";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { publishDashboardChanged } from "./dashboardLive";
import { resolveInboxCustomer } from "./inboxCustomerResolve.service";
import {
  highestInboxUid,
  listInboxMessagesAfterUid,
  listInboxMessagesSince,
  MailboxMessageDetail,
} from "./mailbox.service";
import { touchFromEmail } from "./inboxConversation.service";
import { normalizeMessageId } from "../utils/mailboxReply";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";

const BATCH = 40;
const syncing = new Set<string>();

function messageKey(accountId: string, message: MailboxMessageDetail): string {
  return (
    normalizeMessageId(message.messageId) || `imap:${accountId}:${message.uid}`
  );
}

function emailBodyText(text: string, html: string): string {
  const trimmed = text.trim();
  const source =
    trimmed && !/<\/?[a-z][\s\S]*>/i.test(trimmed) ? trimmed : html || trimmed;
  if (!/<\/?[a-z][\s\S]*>/i.test(source)) return trimmed || source;
  return source
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attachmentsOf(message: MailboxMessageDetail): IEmailAttachment[] {
  return (message.attachments ?? []).map((file, index) => ({
    filename: file.filename || "attachment",
    size: file.size || 0,
    contentType: file.contentType || "application/octet-stream",
    partId: file.partId || String(index),
  }));
}

async function storeInbound(
  account: IEmailAccount,
  message: MailboxMessageDetail,
  publish: boolean,
): Promise<{ inserted: boolean; notify: boolean }> {
  const skip = { inserted: false, notify: false };
  const from = message.from[0];
  const fromEmail = normalizeAccountEmail(from?.address || "");
  if (!fromEmail) return skip;
  if (fromEmail === normalizeAccountEmail(account.fromEmail)) return skip;

  const toEmail =
    normalizeAccountEmail(message.to[0]?.address || "") ||
    normalizeAccountEmail(account.fromEmail);
  const resolved = await resolveInboxCustomer({
    handle: fromEmail,
    handleKind: "email",
    fromName: from?.name || "",
  });
  const customerRef = resolved && Types.ObjectId.isValid(resolved) ? resolved : null;
  let contactRef: Types.ObjectId | null = null;
  if (customerRef) {
    const contact = await CustomerContact.findOne({
      customerRef,
      email: fromEmail,
      ...activeContactFilter,
    })
      .collation({ locale: "en", strength: 2 })
      .select("_id")
      .lean();
    if (contact) contactRef = contact._id;
  }

  const messageId = messageKey(String(account._id), message);
  const at = message.date ? new Date(message.date) : new Date();
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  const result = await EmailCommunication.findOneAndUpdate(
    { emailAccountRef: account._id, messageId },
    {
      $set: {
        emailAccountRef: account._id,
        direction: "inbound",
        fromName: from?.name || fromEmail,
        fromEmail,
        toEmail,
        subject: message.subject || "",
        body: emailBodyText(message.text, message.html) || message.snippet || "",
        html: message.html || "",
        status: "received",
        messageId,
        inReplyTo: normalizeMessageId(message.inReplyTo),
        references: (message.references ?? [])
          .map((value) => normalizeMessageId(value))
          .filter(Boolean),
        imapUid: message.uid,
        mailboxFolder: "inbox",
        receivedAt: when,
        attachments: attachmentsOf(message),
        customerRef,
        contactRef,
        providerMessageId: messageId,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: when,
        createdByUserRef: null,
        errorMessage: null,
      },
    },
    {
      upsert: true,
      new: true,
      includeResultMetadata: true,
      timestamps: false,
      setDefaultsOnInsert: true,
    },
  );
  const doc = result.value;
  if (!doc) return skip;
  const inserted = Boolean(result.lastErrorObject?.upserted);
  const touched = await touchFromEmail(doc, {
    countUnread: inserted,
    publish,
    reopen: true,
  });
  return { inserted, notify: inserted && !touched?.blocked };
}

async function advanceUid(accountId: Types.ObjectId, uid: number): Promise<void> {
  await EmailAccount.updateOne({ _id: accountId }, { $max: { lastSyncedUid: uid } });
}

/**
 * Copy new INBOX mail into EmailCommunication.
 * The first run only records the current highest UID so history stays in the
 * backfill script. Later runs copy mail that arrived after that UID.
 */
export async function syncAccountInbox(accountId: string): Promise<void> {
  if (!Types.ObjectId.isValid(accountId) || syncing.has(accountId)) return;
  syncing.add(accountId);
  try {
    const account = await EmailAccount.findById(accountId);
    if (!account || !account.isActive || !account.imapHost?.trim()) return;
    if (!account.passwordEncrypted) return;

    const cursor = account.lastSyncedUid || 0;
    if (cursor <= 0) {
      const highest = await highestInboxUid(account);
      await advanceUid(account._id, highest);
      return;
    }

    const messages = await listInboxMessagesAfterUid(account, cursor, BATCH);
    let notify = false;
    for (const message of messages) {
      const stored = await storeInbound(account, message, false);
      if (stored.notify) notify = true;
      await advanceUid(account._id, message.uid);
    }
    if (notify) publishDashboardChanged();
    if (messages.length >= BATCH) {
      setTimeout(() => {
        void syncAccountInbox(accountId).catch((err) => {
          console.error("[inbox-email] follow-up sync failed:", err);
        });
      }, 500);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[inbox-email] ${accountId}: ${message}`);
  } finally {
    syncing.delete(accountId);
  }
}

/** Import INBOX mail received on or after `since`. Used by the backfill script. */
export async function importInboxHistory(
  account: IEmailAccount,
  since: Date,
): Promise<number> {
  let afterUid = 0;
  let imported = 0;
  let notify = false;
  let highest = 0;
  for (;;) {
    const messages = await listInboxMessagesSince(account, since, afterUid, BATCH);
    if (messages.length === 0) break;
    for (const message of messages) {
      const stored = await storeInbound(account, message, false);
      if (stored.inserted) imported += 1;
      if (stored.notify) notify = true;
      if (message.uid > highest) highest = message.uid;
      afterUid = message.uid;
    }
    if (messages.length < BATCH) break;
  }
  if (highest > 0) await advanceUid(account._id, highest);
  if (notify) publishDashboardChanged();
  return imported;
}

export async function recordSentMailboxEmail(input: {
  account: IEmailAccount;
  to: string[];
  subject: string;
  html: string;
  text: string;
  messageId?: string | null;
  inReplyTo?: string;
  references?: string[];
  customerRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  createdByUserRef?: Types.ObjectId | null;
  attachments?: { filename: string; size: number; contentType: string }[];
}): Promise<void> {
  const toEmail = normalizeAccountEmail(input.to[0] || "");
  if (!toEmail) return;
  let customerRef = input.customerRef ?? null;
  let contactRef = input.contactRef ?? null;
  if (!customerRef) {
    customerRef = await resolveInboxCustomer({
      handle: toEmail,
      handleKind: "email",
    });
  }
  if (customerRef && !contactRef) {
    const contact = await CustomerContact.findOne({
      customerRef,
      email: toEmail,
      ...activeContactFilter,
    })
      .collation({ locale: "en", strength: 2 })
      .select("_id")
      .lean();
    if (contact) contactRef = contact._id;
  }

  const messageId = input.messageId ? normalizeMessageId(input.messageId) : "";
  const row = await EmailCommunication.create({
    emailAccountRef: input.account._id,
    direction: "outbound",
    fromName: input.account.fromName,
    fromEmail: input.account.fromEmail,
    toEmail,
    subject: input.subject,
    body: input.text,
    html: input.html,
    status: "sent",
    providerMessageId: messageId || null,
    messageId,
    inReplyTo: input.inReplyTo ? normalizeMessageId(input.inReplyTo) : "",
    references: input.references ?? [],
    mailboxFolder: "sent",
    receivedAt: new Date(),
    attachments: (input.attachments ?? []).map((file) => ({ ...file, partId: "" })),
    customerRef,
    contactRef,
    createdByUserRef: input.createdByUserRef ?? null,
  });
  await touchFromEmail(row, { countUnread: false, publish: true });
}
