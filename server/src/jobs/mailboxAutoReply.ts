import { EmailAccount, IEmailAccount } from "../models/mongo/EmailAccount";
import { MailboxAutoReply } from "../models/mongo/MailboxAutoReply";
import { listMailboxMessages } from "../services/mailbox.service";
import { sendMailboxReply } from "../services/mailboxReply.service";
import {
  assignmentMessageKey,
  RECEIPT_REPLY_HTML,
  replySubject,
  shouldSendReceiptReply,
} from "../utils/mailboxReply";

const PER_ACCOUNT_LIMIT = 15;

function replyAddress(message: {
  from: { address: string }[];
  ownAddresses: string[];
}): string {
  const own = new Set(
    message.ownAddresses.map((address) => address.trim().toLowerCase()),
  );
  return (
    message.from.find((item) => {
      const address = item.address.trim().toLowerCase();
      return address && !own.has(address);
    })?.address ?? ""
  );
}

async function acknowledgeAccount(
  account: IEmailAccount,
): Promise<number> {
  const enabledAt = account.autoAcknowledgeEnabledAt;
  if (!account.autoAcknowledge || !enabledAt) return 0;

  const ownAddresses = [account.fromEmail, account.username];
  const messages = await listMailboxMessages(account, "inbox", PER_ACCOUNT_LIMIT);
  let sent = 0;

  for (const message of messages) {
    if (
      !shouldSendReceiptReply({
        enabledAt,
        messageDate: message.date,
        from: message.from,
        ownAddresses,
        subject: message.subject,
      })
    ) {
      continue;
    }

    const to = replyAddress({ from: message.from, ownAddresses });
    if (!to) continue;
    const messageKey = assignmentMessageKey(
      message.messageId,
      "inbox",
      message.uid,
    );

    let claimed = false;
    try {
      const result = await MailboxAutoReply.updateOne(
        { emailAccountRef: account._id, messageId: messageKey },
        {
          $setOnInsert: {
            emailAccountRef: account._id,
            messageId: messageKey,
            uid: message.uid,
            subject: message.subject,
            toEmail: to.toLowerCase(),
          },
        },
        { upsert: true },
      );
      claimed = result.upsertedCount === 1;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: number }).code
          : undefined;
      if (code === 11000) continue;
      throw err;
    }
    if (!claimed) continue;

    try {
      await sendMailboxReply({
        account,
        folder: "inbox",
        uid: message.uid,
        mode: "reply",
        to: [to],
        cc: [],
        bcc: [],
        subject: replySubject(message.subject, "reply"),
        html: RECEIPT_REPLY_HTML,
        automatic: true,
      });
      sent += 1;
    } catch (err) {
      await MailboxAutoReply.deleteOne({
        emailAccountRef: account._id,
        messageId: messageKey,
      });
      const messageText = err instanceof Error ? err.message : "Receipt reply failed.";
      console.error(
        `[mailbox-auto-reply] ${account.friendlyName} uid ${message.uid}: ${messageText}`,
      );
    }
  }

  return sent;
}

export async function runMailboxAutoReplyJob(): Promise<{ sent: number }> {
  const accounts = await EmailAccount.find({
    isActive: true,
    autoAcknowledge: true,
    imapHost: { $nin: ["", null] },
  });

  let sent = 0;
  for (const account of accounts) {
    try {
      sent += await acknowledgeAccount(account);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mailbox check failed.";
      console.error(
        `[mailbox-auto-reply] ${account.friendlyName}: ${message}`,
      );
    }
  }
  return { sent };
}
