import {
  getContactFormSubmissions,
  getInboxConversations,
  markContactFormSubmissionRead,
  markInboxConversationRead,
  type InboxConversationItem,
} from "@/lib/api";

export type InboxReadTarget =
  | { type: "inbox"; conversationId: string }
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

const INBOX_PREVIEW_LIMIT = 100;

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

function conversationPreview(item: InboxConversationItem): InboxPreview {
  return {
    id: `inbox-${item.id}`,
    kind: item.lastChannel === "email" ? "Email" : "Text",
    title: item.displayName.trim() || item.handle || "Unknown",
    preview: item.lastPreview.trim() || (item.lastChannel === "email" ? "Email" : "Text message"),
    at: item.lastMessageAt,
    href: `/dashboard/inboxes?c=${item.id}`,
    readTarget: { type: "inbox", conversationId: item.id },
  };
}

async function loadUnreadConversations(token: string): Promise<InboxPreview[]> {
  const collected: InboxConversationItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await getInboxConversations(token, {
      status: "open",
      filter: "unread",
      cursor,
    });
    if (!cursor) collected.push(...(page.pinned ?? []));
    collected.push(...page.conversations);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && collected.length < INBOX_PREVIEW_LIMIT);
  return collected.slice(0, INBOX_PREVIEW_LIMIT).map(conversationPreview);
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
  const [conversations, contactForms] = await Promise.all([
    loadUnreadConversations(token),
    loadUnreadContactForms(token),
  ]);
  return [...conversations, ...contactForms].sort((left, right) => {
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
  if (target.type === "inbox") {
    await markInboxConversationRead(token, target.conversationId);
    return;
  }
  await markContactFormSubmissionRead(token, target.submissionId);
}
