import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { IEmailAccount } from "../models/mongo/EmailAccount";
import { decryptCredential } from "../utils/credentialsCrypto";
import {
  resolveSentMailbox,
  snippetFromPartialSource,
} from "../utils/imapMailbox";
import { normalizeMessageId } from "../utils/mailboxReply";
import {
  belongsToThread,
  messageIdLookupValues,
  relatedMessageIds,
  threadIdSet,
} from "../utils/mailboxThread";

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
  cc: MailboxAddress[];
  date: string | null;
  seen: boolean;
  snippet: string;
  messageId: string;
  inReplyTo: string;
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
  references: string[];
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
const MAX_THREAD_MESSAGES = 20;
const MAX_THREAD_IDS = 12;
const MAX_TEXT = 200_000;
const MAX_HTML = 500_000;
const TEMPORARY_AUTH_EXTRA_ATTEMPTS = 2;
const TEMPORARY_AUTH_RETRY_DELAY_MS = 1500;

export const MAILBOX_CREDENTIAL_MESSAGE =
  "Mailbox login failed. Check the username and password.";

export const MAILBOX_TEMPORARY_LOGIN_MESSAGE =
  "The mail server temporarily refused login. Wait a minute and reload. If it keeps failing, reset the mailbox password in Namecheap Private Email and save it again in Control Panel.";

type ImapFailure = {
  authenticationFailed?: boolean;
  mailboxMissing?: boolean;
  message?: string;
  serverResponseCode?: string;
  response?: string;
};

function asImapFailure(err: unknown): ImapFailure {
  if (!err || typeof err !== "object") return {};
  return err as ImapFailure;
}

/** Namecheap/Dovecot uses UNAVAILABLE for a temporary refusal. A permanent
 * AUTHENTICATIONFAILED stays a credential error even if the text mentions
 * a temporary failure. */
export function isTemporaryImapAuthFailure(err: unknown): boolean {
  const imap = asImapFailure(err);
  const code = (imap.serverResponseCode || "").toUpperCase();
  if (code === "AUTHENTICATIONFAILED") return false;
  if (code === "UNAVAILABLE") return true;
  const text = `${imap.response || ""} ${imap.message || ""}`;
  return /temporary authentication failure/i.test(text);
}

export function toMailboxError(err: unknown): MailboxError {
  if (err instanceof MailboxError) return err;
  const imap = asImapFailure(err);
  if (imap.authenticationFailed || isTemporaryImapAuthFailure(err)) {
    if (isTemporaryImapAuthFailure(err)) {
      return new MailboxError(MAILBOX_TEMPORARY_LOGIN_MESSAGE, 503);
    }
    return new MailboxError(MAILBOX_CREDENTIAL_MESSAGE, 401);
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

function logImapAuthFailure(err: unknown, retrying: boolean): void {
  const imap = asImapFailure(err);
  console.error("[mailbox] IMAP login failed:", {
    code: imap.serverResponseCode || "",
    response: imap.response || imap.message || "",
    retrying,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function openMailboxClient(
  account: IEmailAccount,
  host: string,
  password: string,
  connectionTimeout = 15_000,
): ImapFlow {
  return new ImapFlow({
    host,
    port: account.imapPort || 993,
    secure: account.imapSecure !== false,
    auth: { user: account.username, pass: password },
    logger: false,
    connectionTimeout,
    greetingTimeout: connectionTimeout,
    socketTimeout: connectionTimeout,
  });
}

async function withMailboxClient<T>(
  account: IEmailAccount,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const { host, password } = assertImapReady(account);
  const maxAttempts = 1 + TEMPORARY_AUTH_EXTRA_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(TEMPORARY_AUTH_RETRY_DELAY_MS);
    }
    const client = openMailboxClient(account, host, password);
    let connected = false;
    try {
      await client.connect();
      connected = true;
      return await fn(client);
    } catch (err) {
      lastError = err;
      const retry = attempt < maxAttempts && isTemporaryImapAuthFailure(err);
      const imap = asImapFailure(err);
      if (imap.authenticationFailed || isTemporaryImapAuthFailure(err)) {
        logImapAuthFailure(err, retry);
      }
      if (!retry) {
        throw toMailboxError(err);
      }
    } finally {
      if (connected) {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      } else {
        client.close();
      }
    }
  }

  throw toMailboxError(lastError);
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
    inReplyTo?: string;
    subject?: string;
    messageId?: string;
    from?: { name?: string; address?: string }[];
    to?: { name?: string; address?: string }[];
    cc?: { name?: string; address?: string }[];
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
    cc: addresses(envelope?.cc),
    date: messageDate(envelope?.date, msg.internalDate),
    inReplyTo: envelope?.inReplyTo?.trim() || "",
    seen: msg.flags?.has("\\Seen") ?? false,
    snippet: text,
    messageId: envelope?.messageId?.trim() || "",
  };
}

function referenceList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => item.trim()).filter(Boolean);
}

function parserAddresses(
  value:
    | { value?: { name?: string; address?: string }[] }
    | { value?: { name?: string; address?: string }[] }[]
    | undefined,
): MailboxAddress[] {
  if (!value) return [];
  const objects = Array.isArray(value) ? value : [value];
  return objects.flatMap((item) => addresses(item.value));
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

const UNSEEN_SEARCH_LIMIT = 15;
const UNSEEN_SEARCH_TIMEOUT_MS = 4_000;

export type UnseenFromQuery =
  | { seen: false; from: string }
  | { seen: false; or: { from: string }[] };

/** IMAP search for unseen inbox mail from these addresses. Empty input searches nothing. */
export function unseenFromQuery(addresses: string[]): UnseenFromQuery | null {
  const from = [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0),
    ),
  ].slice(0, UNSEEN_SEARCH_LIMIT);
  if (from.length === 0) return null;
  if (from.length === 1) return { seen: false, from: from[0] };
  return { seen: false, or: from.map((address) => ({ from: address })) };
}

/**
 * True when INBOX has an unseen message from one of the addresses.
 * Does not mark mail seen. Closes the connection if the server is slow.
 */
export async function hasUnseenInboxFrom(
  account: IEmailAccount,
  addresses: string[],
): Promise<boolean> {
  const query = unseenFromQuery(addresses);
  if (!query) return false;

  const { host, password } = assertImapReady(account);
  const client = openMailboxClient(
    account,
    host,
    password,
    UNSEEN_SEARCH_TIMEOUT_MS,
  );
  let connected = false;
  let settled = false;
  const killer = setTimeout(() => {
    if (!settled) client.close();
  }, UNSEEN_SEARCH_TIMEOUT_MS);

  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock("INBOX");
    try {
      const found = await client.search(query as never, { uid: true });
      return Array.isArray(found) && found.length > 0;
    } finally {
      lock.release();
    }
  } finally {
    settled = true;
    clearTimeout(killer);
    if (connected) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    } else {
      client.close();
    }
  }
}

export async function appendToSentFolder(
  account: IEmailAccount,
  raw: Buffer,
): Promise<void> {
  await withMailboxClient(account, async (client) => {
    const path = await resolveFolderPath(client, "sent");
    const appended = await client.append(path, raw, ["\\Seen"]);
    if (!appended) {
      throw new MailboxError("Could not save a copy to the Sent folder.", 502);
    }
  });
}

async function withMailboxLock<T>(
  client: ImapFlow,
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(path);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

async function readLockedMessage(
  client: ImapFlow,
  uid: number,
  markSeen: boolean,
): Promise<MailboxMessageDetail> {
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
  if (markSeen && !summary.seen) {
    try {
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      summary.seen = true;
    } catch (err) {
      console.error("[mailbox] failed to mark message seen:", err);
    }
  }
  const text = (parsed.text || "").slice(0, MAX_TEXT);
  const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
  const parsedCc = parserAddresses(parsed.cc);
  return {
    ...summary,
    cc: parsedCc.length > 0 ? parsedCc : summary.cc,
    messageId: parsed.messageId?.trim() || summary.messageId,
    inReplyTo: parsed.inReplyTo?.trim() || msg.envelope?.inReplyTo?.trim() || "",
    references: referenceList(parsed.references),
    snippet: text.replace(/\s+/g, " ").trim().slice(0, 160) || summary.snippet,
    text,
    html: rawHtml.slice(0, MAX_HTML),
    attachments: (parsed.attachments ?? []).map((file) => ({
      filename: file.filename || "attachment",
      size: file.size || 0,
      contentType: file.contentType || "application/octet-stream",
    })),
  };
}

const THREAD_HEADERS = ["message-id", "in-reply-to", "references"] as const;
const LOCATE_UID_CAP = 40;

export type MailboxLocationCandidate = {
  folder: MailboxFolder;
  uid: number;
  dateMs: number;
  messageId: string;
};

/** Prefer the Sent copy whose Message-ID matches. Otherwise the newest related message. */
export function chooseMailboxLocation(
  messageId: string,
  candidates: MailboxLocationCandidate[],
): { folder: MailboxFolder; uid: number } | null {
  if (candidates.length === 0) return null;
  const target = normalizeMessageId(messageId);
  const sentExact = target
    ? candidates.filter(
        (item) =>
          item.folder === "sent" &&
          normalizeMessageId(item.messageId) === target,
      )
    : [];
  const pool = sentExact.length > 0 ? sentExact : candidates;
  const newest = pool.reduce((best, item) => {
    if (item.dateMs !== best.dateMs) {
      return item.dateMs > best.dateMs ? item : best;
    }
    return item.uid > best.uid ? item : best;
  });
  return { folder: newest.folder, uid: newest.uid };
}

async function searchHeaderUids(
  client: ImapFlow,
  header: string,
  values: string[],
): Promise<number[]> {
  const uids = new Set<number>();
  for (const value of values) {
    const needle = value.trim();
    if (!needle) continue;
    try {
      const found = await client.search(
        { header: { [header]: needle } } as never,
        { uid: true },
      );
      if (!Array.isArray(found)) continue;
      for (const match of found) uids.add(match);
    } catch (err) {
      console.error("[mailbox] header search failed:", header, err);
    }
  }
  return [...uids];
}

function cappedUids(uids: Iterable<number>): number[] {
  return [...new Set(uids)].sort((left, right) => right - left).slice(0, LOCATE_UID_CAP);
}

async function describeLocated(
  client: ImapFlow,
  folder: MailboxFolder,
  uids: Iterable<number>,
): Promise<MailboxLocationCandidate[]> {
  const rows: MailboxLocationCandidate[] = [];
  for (const uid of cappedUids(uids)) {
    const msg = await client.fetchOne(
      String(uid),
      { uid: true, envelope: true, internalDate: true },
      { uid: true },
    );
    if (!msg) continue;
    const date = messageDate(msg.envelope?.date, msg.internalDate);
    rows.push({
      folder,
      uid: msg.uid,
      dateMs: date ? new Date(date).getTime() : 0,
      messageId: msg.envelope?.messageId?.trim() || "",
    });
  }
  return rows;
}

async function searchThreadUids(
  client: ImapFlow,
  ids: string[],
): Promise<number[]> {
  const uids = new Set<number>();
  for (const id of ids) {
    const bracketed = normalizeMessageId(id);
    if (!bracketed) continue;
    for (const header of THREAD_HEADERS) {
      const found = await searchHeaderUids(client, header, [bracketed]);
      for (const match of found) uids.add(match);
    }
  }
  return [...uids];
}

async function sentFolderPath(client: ImapFlow): Promise<string | null> {
  try {
    return await resolveFolderPath(client, "sent");
  } catch (err) {
    if (err instanceof MailboxError) return null;
    throw err;
  }
}

export async function locateMailboxMessage(
  account: IEmailAccount,
  rawMessageId: string,
): Promise<{ folder: MailboxFolder; uid: number } | null> {
  const target = normalizeMessageId(rawMessageId);
  if (!target) {
    throw new MailboxError("Message id is required.", 400);
  }
  const lookup = messageIdLookupValues([rawMessageId]);

  return withMailboxClient(account, async (client) => {
    const sentPath = await sentFolderPath(client);
    if (sentPath) {
      const exact = await withMailboxLock(client, sentPath, async () => {
        const uids = await searchHeaderUids(client, "message-id", lookup);
        const described = await describeLocated(client, "sent", uids);
        return chooseMailboxLocation(
          target,
          described.filter(
            (item) => normalizeMessageId(item.messageId) === target,
          ),
        );
      });
      if (exact) return exact;
    }

    const folders: { folder: MailboxFolder; path: string }[] = [
      { folder: "inbox", path: "INBOX" },
    ];
    if (sentPath) folders.push({ folder: "sent", path: sentPath });

    const candidates: MailboxLocationCandidate[] = [];
    for (const item of folders) {
      const found = await withMailboxLock(client, item.path, async () => {
        const uids = new Set<number>();
        for (const header of THREAD_HEADERS) {
          const matches = await searchHeaderUids(client, header, lookup);
          for (const uid of matches) uids.add(uid);
        }
        return describeLocated(client, item.folder, uids);
      });
      candidates.push(...found);
    }
    return chooseMailboxLocation(target, candidates);
  });
}

export async function getMailboxMessage(
  account: IEmailAccount,
  folder: MailboxFolder,
  uid: number,
): Promise<MailboxMessageDetail> {
  return withMailboxClient(account, async (client) => {
    const path = await resolveFolderPath(client, folder);
    const message = await withMailboxLock(client, path, () =>
      readLockedMessage(client, uid, folder === "inbox"),
    );
    return {
      ...message,
      html: message.html ? sanitizeInboundEmailHtml(message.html) : "",
    };
  });
}

export async function listImapThreadMessages(
  account: IEmailAccount,
  folder: MailboxFolder,
  uid: number,
): Promise<Array<MailboxMessageDetail & { folder: MailboxFolder }>> {
  return withMailboxClient(account, async (client) => {
    const folders: { folder: MailboxFolder; path: string }[] = [
      { folder: "inbox", path: "INBOX" },
    ];
    try {
      folders.push({
        folder: "sent",
        path: await resolveFolderPath(client, "sent"),
      });
    } catch (err) {
      if (folder === "sent") throw err;
      console.error("[mailbox] sent folder unavailable for thread", err);
    }

    const selectedPath = folders.find((item) => item.folder === folder);
    if (!selectedPath) {
      throw new MailboxError("Mailbox folder was not found.", 404);
    }

    const byKey = new Map<string, MailboxMessageDetail & { folder: MailboxFolder }>();
    const selected = await withMailboxLock(client, selectedPath.path, () =>
      readLockedMessage(client, uid, folder === "inbox"),
    );
    byKey.set(`${folder}:${uid}`, { ...selected, folder });

    const searched = new Set<string>();
    let pending = relatedMessageIds(selected).slice(0, MAX_THREAD_IDS);

    for (
      let pass = 0;
      pass < 2 && pending.length > 0 && byKey.size < MAX_THREAD_MESSAGES;
      pass += 1
    ) {
      const ids = pending
        .filter((id) => !searched.has(id))
        .slice(0, MAX_THREAD_IDS);
      for (const id of ids) searched.add(id);
      if (ids.length === 0) break;

      for (const target of folders) {
        if (byKey.size >= MAX_THREAD_MESSAGES) break;
        try {
          await withMailboxLock(client, target.path, async () => {
            const found = await searchThreadUids(client, ids);
            if (target.folder === folder) found.push(uid);
            const unique = [...new Set(found)]
              .sort((left, right) => right - left)
              .slice(0, MAX_THREAD_MESSAGES);
            for (const matchUid of unique) {
              const key = `${target.folder}:${matchUid}`;
              if (byKey.has(key) || byKey.size >= MAX_THREAD_MESSAGES) continue;
              try {
                const message = await readLockedMessage(client, matchUid, false);
                const known = threadIdSet([...byKey.values()]);
                if (!belongsToThread(message, known)) continue;
                byKey.set(key, { ...message, folder: target.folder });
              } catch (err) {
                console.error("[mailbox] thread message fetch failed", err);
              }
            }
          });
        } catch (err) {
          if (target.folder === folder) throw err;
          console.error("[mailbox] thread folder search failed", err);
        }
      }

      pending = [...threadIdSet([...byKey.values()])].filter(
        (id) => !searched.has(id),
      );
    }

    return [...byKey.values()];
  });
}
