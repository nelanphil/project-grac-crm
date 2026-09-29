import { IEmailAccount } from "../models/mongo/EmailAccount";
import { formatFrom, sendWithEmailAccount } from "./email.service";
import { sanitizeEmailBodyHtml } from "../utils/emailChrome";
import {
  buildRfc822Message,
  composeReplyHtml,
  htmlToPlainText,
  isBlankHtml,
  MailboxReplyMode,
  threadingHeaders,
} from "../utils/mailboxReply";
import {
  appendToSentFolder,
  getMailboxMessage,
  MailboxError,
  MailboxFolder,
} from "./mailbox.service";

function joinAddresses(list: string[]): string {
  return list.join(", ");
}

export async function sendMailboxReply(input: {
  account: IEmailAccount;
  folder: MailboxFolder;
  uid: number;
  mode: MailboxReplyMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  automatic?: boolean;
}): Promise<{ sent: true; savedToSent: boolean }> {
  if (input.to.length === 0) {
    throw new MailboxError("Add at least one recipient.", 400);
  }
  const bodyHtml = sanitizeEmailBodyHtml(input.html);
  if (isBlankHtml(bodyHtml)) {
    throw new MailboxError("Write a message before sending.", 400);
  }

  const original = await getMailboxMessage(
    input.account,
    input.folder,
    input.uid,
  );
  const html = composeReplyHtml({
    mode: input.mode,
    bodyHtml,
    original: {
      html: original.html,
      text: original.text,
      from: original.from,
      to: original.to,
      date: original.date,
      subject: original.subject,
    },
  });
  const headers = {
    ...(input.mode === "forward"
      ? {}
      : threadingHeaders({
          messageId: original.messageId,
          references: original.references,
        })),
    ...(input.automatic
      ? {
          "Auto-Submitted": "auto-replied",
          "X-Auto-Response-Suppress": "All",
        }
      : {}),
  };

  const result = await sendWithEmailAccount(input.account, {
    to: joinAddresses(input.to),
    cc: joinAddresses(input.cc),
    bcc: joinAddresses(input.bcc),
    subject: input.subject,
    text: htmlToPlainText(html),
    html,
    headers,
  });

  let savedToSent = false;
  try {
    const raw = buildRfc822Message({
      from: formatFrom(input.account.fromName, input.account.fromEmail),
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      text: htmlToPlainText(html),
      html,
      headers,
      messageId: result.messageId,
    });
    await appendToSentFolder(input.account, raw);
    savedToSent = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sent copy failed.";
    console.error("[mailbox] could not append sent copy:", message);
  }

  return { sent: true, savedToSent };
}
