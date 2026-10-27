import {
  getContactFormSubmissions,
  getEmailAccounts,
  getMailboxMessages,
  getMessagingThreads,
  markContactFormSubmissionRead,
  markMailboxMessageSeen,
  markMessagingThreadRead,
  type MailboxAddress,
} from "@/lib/api";
import { contactDisplayName } from "@/components/messaging/conversationUtils";

export type InboxReadTarget =
  | { type: "text"; threadId: string }
  | { type: "email"; accountId: string; uid: number }
  | { type: "contact-form"; submissionId: string };

export type InboxPreview = {
  id: string;
  kind: "Text" | "Email" | "Contact form";
  title: string;
  preview: string;
  at: string | null;
  href: string;
  readTarget: InboxReadTarget;
};

function emailSender(from: MailboxAddress[]): string {
  const first = from[0];
  if (!first) return "Unknown";
  return first.name.trim() || first.address || "Unknown";
}

function contactFormHref(createdAt: string): string {
  const date = new Date(createdAt);
  const params = new URLSearchParams({
    tab: "contact-form",
  });
  if (!Number.isNaN(date.getTime())) {
    params.set("year", String(date.getFullYear()));
    params.set("month", String(date.getMonth() + 1));
  }
  return `/dashboard/messaging?${params.toString()}`;
}

function excerpt(content: string): string {
  const text = content
    .replace(/\\r\\n|\\n|\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157)}…`;
}

async function loadUnreadEmails(token: string): Promise<InboxPreview[]> {
  try {
    const { accounts } = await getEmailAccounts(token);
    const connected = accounts.filter(
      (account) => account.isActive && account.imapHost.trim(),
    );
    const mailboxes = await Promise.all(
      connected.map(async (account) => {
        try {
          const { messages } = await getMailboxMessages(
            token,
            account._id,
            "inbox",
          );
          return messages
            .filter((message) => !message.seen)
            .map((message): InboxPreview => ({
              id: `email-${account._id}-${message.uid}`,
              kind: "Email",
              title: emailSender(message.from),
              preview:
                message.subject.trim() ||
                message.snippet.trim() ||
                "(no subject)",
              at: message.date,
              href: "/dashboard/inboxes",
              readTarget: {
                type: "email",
                accountId: account._id,
                uid: message.uid,
              },
            }));
        } catch {
          return [] as InboxPreview[];
        }
      }),
    );
    return mailboxes.flat();
  } catch {
    return [];
  }
}

async function loadUnreadContactForms(token: string): Promise<InboxPreview[]> {
  try {
    const result = await getContactFormSubmissions(token, {
      unread: true,
      page: 1,
      pageSize: 100,
    });
    return result.submissions.map((item) => ({
      id: `contact-form-${item._id}`,
      kind: "Contact form" as const,
      title: `${item.firstName} ${item.lastName}`.trim() || "Website contact",
      preview: excerpt(item.message),
      at: item.createdAt,
      href: contactFormHref(item.createdAt),
      readTarget: {
        type: "contact-form" as const,
        submissionId: item._id,
      },
    }));
  } catch {
    return [];
  }
}

export async function loadUnreadInbox(token: string): Promise<InboxPreview[]> {
  const [threadsResult, emails, contactForms] = await Promise.all([
    getMessagingThreads(token, { unread: true, page: 1, pageSize: 100 }),
    loadUnreadEmails(token),
    loadUnreadContactForms(token),
  ]);
  const texts: InboxPreview[] = threadsResult.threads.map((thread) => ({
    id: `text-${thread._id}`,
    kind: "Text",
    title: contactDisplayName(thread),
    preview: thread.lastMessagePreview.trim() || "Text message",
    at: thread.lastMessageAt,
    href: "/dashboard/inboxes",
    readTarget: { type: "text", threadId: thread._id },
  }));
  return [...texts, ...emails, ...contactForms].sort((left, right) => {
    const leftTime = left.at ? new Date(left.at).getTime() : 0;
    const rightTime = right.at ? new Date(right.at).getTime() : 0;
    return rightTime - leftTime;
  });
}

export async function markInboxPreviewRead(
  token: string,
  item: InboxPreview,
): Promise<void> {
  const target = item.readTarget;
  if (target.type === "text") {
    await markMessagingThreadRead(token, target.threadId);
    return;
  }
  if (target.type === "email") {
    await markMailboxMessageSeen(token, target.accountId, target.uid, "inbox");
    return;
  }
  await markContactFormSubmissionRead(token, target.submissionId);
}
