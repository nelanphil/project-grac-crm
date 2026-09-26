import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { IEmailAccount } from "../models/mongo/EmailAccount";
import { decryptCredential } from "../utils/credentialsCrypto";
import {
  resolveSentMailbox,
  snippetFromPartialSource,
} from "../utils/imapMailbox";

export type MailboxFolder = "inbox" | "sent";

export type MailboxAddress = {
  name: string;
  address: string;
};

export type MailboxMessageSummary = {
  uid: number;
  subject: string;
  from: MailboxAddress[];
  to: MailboxAddress[];
  date: string | null;
  seen: boolean;
  snippet: string;
};

export type MailboxAttachmentMeta = {
  filename: string;
  size: number;
  contentType: string;
};

export type MailboxMessageDetail = MailboxMessageSummary & {
  text: string;
  html: string;
  attachments: MailboxAttachmentMeta[];
};

export class MailboxError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "MailboxError";
    this.status = status;
  }
}

const MAX_LIST = 50;
const SOURCE_PREVIEW_BYTES = 2500;
const MAX_TEXT = 200_000;
const MAX_HTML = 500_000;

function toMailboxError(err: unknown): MailboxError {
  if (err instanceof MailboxError) return err;
  const imap = err as {
    authenticationFailed?: boolean;
    mailboxMissing?: boolean;
    message?: string;
  };
  if (imap.authenticationFailed) {
    return new MailboxError(
      "Mailbox login failed. Check the username and password.",
      401,
    );
  }
  if (imap.mailboxMissing) {
    return new MailboxError("Mailbox folder was not found.", 404);
  }
  const message = imap.message || "Mailbox connection failed.";
  if (
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|certificate|timed out/i.test(
      message,
    )
  ) {
    return new MailboxError(`Could not connect to the mailbox. ${message}`, 502);
  }
  return new MailboxError(message, 502);
}

function addresses(
  list: { name?: string; address?: string }[] | undefined,
): MailboxAddress[] {
  return (list ?? [])
    .filter((item) => Boolean(item.address?.trim()))
    .map((item) => ({
      name: item.name?.trim() || "",
      address: item.address!.trim(),
    }));
}

function messageDate(
  envelopeDate?: Date | string,
  internalDate?: Date | string,
): string | null {
  const value = envelopeDate || internalDate;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function sanitizeInboundEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "h3",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "center",
      "span",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan", "align", "valign"],
      th: ["colspan", "rowspan", "align", "valign"],
      table: ["border", "cellpadding", "cellspacing", "width", "align"],
      "*": ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
  });
}

function assertImapReady(account: IEmailAccount): { host: string; password: string } {
  const host = account.imapHost?.trim() ?? "";
  if (!host) {
    throw new MailboxError("IMAP is not configured for this account.", 400);
  }
  if (!account.passwordEncrypted) {
    throw new MailboxError("Email account has no password set.", 400);
  }
  let password: string;
  try {
    password = decryptCredential(account.passwordEncrypted);
  } catch {
    throw new MailboxError("Could not read the stored mailbox password.", 500);
  }
  return { host, password };
}

async function withMailboxClient<T>(
  account: IEmailAccount,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const { host, password } = assertImapReady(account);
  const client = new ImapFlow({
    host,
    port: account.imapPort || 993,
    secure: account.imapSecure !== false,
    auth: { user: account.username, pass: password },
    logger: false,
    connectionTimeout: 15_000,
  });

  try {
    await client.connect();
    return await fn(client);
  } catch (err) {
    throw toMailboxError(err);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

async function resolveFolderPath(
  client: ImapFlow,
  folder: MailboxFolder,
): Promise<string> {
  if (folder === "inbox") return "INBOX";
  const listed = await client.list();
  const path = resolveSentMailbox(
    listed.map((box) => ({
      path: box.path,
      name: box.name,
      specialUse: box.specialUse,
    })),
  );
  if (!path) {
    throw new MailboxError("This account has no Sent folder.", 404);
  }
  return path;
}

function toSummary(msg: {
  uid: number;
  flags?: Set<string>;
  envelope?: {
    subject?: string;
    from?: { name?: string; address?: string }[];
    to?: { name?: string; address?: string }[];
    date?: Date | string;
  };
  internalDate?: Date | string;
  source?: Buffer;
}): MailboxMessageSummary {
  const envelope = msg.envelope;
  const text = snippetFromPartialSource(msg.source);
  return {
    uid: msg.uid,
    subject: envelope?.subject?.trim() || "(no subject)",
    from: addresses(envelope?.from),
    to: addresses(envelope?.to),
    date: messageDate(envelope?.date, msg.internalDate),
    seen: msg.flags?.has("\\Seen") ?? false,
    snippet: text,
  };
}

export async function testMailboxConnection(
  account: IEmailAccount,
): Promise<{ mailbox: string }> {
  await withMailboxClient(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
  });
  return { mailbox: "INBOX" };
}

export async function listMailboxMessages(
  account: IEmailAccount,
  folder: MailboxFolder,
  limit: number,
): Promise<MailboxMessageSummary[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_LIST);
  return withMailboxClient(account, async (client) => {
    const path = await resolveFolderPath(client, folder);
    const lock = await client.getMailboxLock(path);
    try {
      const box = client.mailbox;
      const exists = box && typeof box === "object" ? box.exists : 0;
      if (!exists) return [];
      const start = Math.max(1, exists - capped + 1);
      const rows: MailboxMessageSummary[] = [];
      for await (const msg of client.fetch(`${start}:*`, {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        source: { start: 0, maxLength: SOURCE_PREVIEW_BYTES },
      })) {
        rows.push(toSummary(msg));
      }
      rows.reverse();
      return rows;
    } finally {
      lock.release();
    }
  });
}

export async function getMailboxMessage(
  account: IEmailAccount,
  folder: MailboxFolder,
  uid: number,
): Promise<MailboxMessageDetail> {
  return withMailboxClient(account, async (client) => {
    const path = await resolveFolderPath(client, folder);
    const lock = await client.getMailboxLock(path);
    try {
      const msg = await client.fetchOne(
        String(uid),
        {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          source: true,
        },
        { uid: true },
      );
      if (!msg || !msg.source) {
        throw new MailboxError("Message not found.", 404);
      }
      const parsed = await simpleParser(msg.source);
      const summary = toSummary(msg);
      const text = (parsed.text || "").slice(0, MAX_TEXT);
      const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
      return {
        ...summary,
        snippet: text.replace(/\s+/g, " ").trim().slice(0, 160) || summary.snippet,
        text,
        html: rawHtml
          ? sanitizeInboundEmailHtml(rawHtml.slice(0, MAX_HTML))
          : "",
        attachments: (parsed.attachments ?? []).map((file) => ({
          filename: file.filename || "attachment",
          size: file.size || 0,
          contentType: file.contentType || "application/octet-stream",
        })),
      };
    } finally {
      lock.release();
    }
  });
}
