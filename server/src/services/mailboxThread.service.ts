import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { IEmailAccount } from "../models/mongo/EmailAccount";
import { normalizeMessageId } from "../utils/mailboxReply";
import {
  messageIdLookupValues,
  threadIdSet,
  withDisplayBodies,
} from "../utils/mailboxThread";
import {
  listImapThreadMessages,
  MailboxAddress,
  MailboxAttachmentMeta,
  MailboxFolder,
  sanitizeInboundEmailHtml,
} from "./mailbox.service";

const MAX_TEXT = 200_000;
const MAX_HTML = 500_000;

export type MailboxThreadMessage = {
  source: "imap" | "crm";
  folder: MailboxFolder;
  uid: number | null;
  subject: string;
  from: MailboxAddress[];
  to: MailboxAddress[];
  cc: MailboxAddress[];
  date: string | null;
  seen: boolean;
  snippet: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  text: string;
  html: string;
  displayText: string;
  displayHtml: string;
  attachments: MailboxAttachmentMeta[];
};

function snippetFrom(text: string, fallback: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160) || fallback;
}

function timeValue(value: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export async function loadMailboxThread(
  account: IEmailAccount,
  folder: MailboxFolder,
  uid: number,
): Promise<MailboxThreadMessage[]> {
  const imapMessages = await listImapThreadMessages(account, folder, uid);
  const ids = threadIdSet(imapMessages);
  const present = new Set(
    imapMessages
      .map((message) => normalizeMessageId(message.messageId))
      .filter(Boolean),
  );

  const crmRows =
    ids.size === 0
      ? []
      : await EmailCommunication.find({
          emailAccountRef: account._id,
          status: "sent",
          providerMessageId: { $in: messageIdLookupValues([...ids]) },
        })
          .sort({ createdAt: 1 })
          .limit(20)
          .lean();

  const crmMessages = crmRows.flatMap((row) => {
    const messageId = normalizeMessageId(row.providerMessageId ?? "");
    if (!messageId || present.has(messageId)) return [];
    const text = (row.body ?? "").slice(0, MAX_TEXT);
    const rawHtml = row.html ?? "";
    present.add(messageId);
    return [
      {
        source: "crm" as const,
        folder: "sent" as const,
        uid: null,
        subject: row.subject?.trim() || "(no subject)",
        from: [{ name: row.fromName ?? "", address: row.fromEmail ?? "" }],
        to: [{ name: "", address: row.toEmail ?? "" }],
        cc: [],
        date: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        seen: true,
        snippet: snippetFrom(text, row.subject?.trim() || ""),
        messageId,
        inReplyTo: "",
        references: [],
        text,
        html: rawHtml.slice(0, MAX_HTML),
        attachments: [],
        id: `crm:${String(row._id)}`,
      },
    ];
  });

  const combined = [
    ...imapMessages.map((message) => ({
      source: "imap" as const,
      folder: message.folder,
      uid: message.uid,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      date: message.date,
      seen: message.seen,
      snippet: message.snippet,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      references: message.references,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      id: `${message.folder}:${message.uid}`,
    })),
    ...crmMessages,
  ];

  return withDisplayBodies(combined)
    .map(({ id: _id, ...message }) => ({
      ...message,
      html: message.html ? sanitizeInboundEmailHtml(message.html) : "",
      displayHtml: message.displayHtml
        ? sanitizeInboundEmailHtml(message.displayHtml)
        : "",
    }))
    .sort((left, right) => timeValue(left.date) - timeValue(right.date));
}
