"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  InboxChannels,
  InboxConversationItem,
  InboxContext,
  InboxTemplate,
  InboxTimelineMessage,
  callInboxConversation,
  closeInboxConversation,
  getInboxContext,
  getInboxTemplates,
  getInboxTimeline,
  reopenInboxConversation,
  sendInboxEmail,
  sendInboxSms,
} from "@/lib/api";
import {
  crmPlaybackSrc,
  formatDuration,
} from "@/components/messaging/conversationUtils";
import { clockTime, dayLabel, emailDisplayHtml, emailPlainText } from "./inboxFormat";
import CallFollowUp from "./CallFollowUp";
import {
  Check,
  ChevronLeft,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Search,
  Send,
} from "lucide-react";

type ConversationThreadProps = {
  token: string;
  conversationId: string;
  channels: InboxChannels | null;
  canWrite: boolean;
  canTasks?: boolean;
  refreshKey: number;
  onBack: () => void;
  onActivity: () => void;
  onConversation: (conversation: InboxConversationItem) => void;
  onAction?: (
    action: "done" | "pin" | "block" | "delete" | "task",
    conversation: InboxConversationItem,
  ) => void;
};

function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

export default function ConversationThread({
  token,
  conversationId,
  channels,
  canWrite,
  canTasks = false,
  refreshKey,
  onBack,
  onActivity,
  onConversation,
  onAction,
}: ConversationThreadProps) {
  const [conversation, setConversation] = useState<InboxConversationItem | null>(null);
  const [messages, setMessages] = useState<InboxTimelineMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const loading = loadedFor !== `${conversationId}:${refreshKey}`;
  const [error, setError] = useState<string | null>(null);
  const [threadQuery, setThreadQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [contactId, setContactId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [emailAccountId, setEmailAccountId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<InboxTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contacts, setContacts] = useState<InboxContext["contacts"]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const onConversationRef = useRef(onConversation);
  useEffect(() => {
    onConversationRef.current = onConversation;
  }, [onConversation]);

  useEffect(() => {
    let cancelled = false;
    getInboxTimeline(token, conversationId)
      .then((result) => {
        if (cancelled) return;
        setConversation(result.conversation);
        setMessages(result.messages);
        setHasMore(result.hasMore);
        setNextBefore(result.nextBefore);
        if (result.conversation) onConversationRef.current(result.conversation);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load this conversation");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(`${conversationId}:${refreshKey}`);
      });
    return () => {
      cancelled = true;
    };
  }, [token, conversationId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    getInboxContext(token, conversationId)
      .then((result) => {
        if (!cancelled) setContacts(result.contacts);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, conversationId, refreshKey]);

  const seededId = useRef("");

  useEffect(() => {
    if (!conversation || seededId.current === conversation.id) return;
    seededId.current = conversation.id;
    setChannel(conversation.phone ? "sms" : "email");
    setFromNumber(conversation.ourNumber || "");
    setEmailAccountId(conversation.emailAccountId || "");
    setContactId("");
    setBody("");
    setSubject("");
    setTemplateId("");
  }, [conversation]);

  useEffect(() => {
    let cancelled = false;
    getInboxTemplates(token, channel === "email" ? "email" : "sms")
      .then((result) => {
        if (!cancelled) setTemplates(result.templates);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, channel]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const visible = useMemo(() => {
    const q = threadQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((message) =>
      `${message.body} ${message.subject} ${message.transcript}`.toLowerCase().includes(q),
    );
  }, [messages, threadQuery]);

  const numbers = (channels?.twilioAccounts ?? []).flatMap((account) =>
    account.numbers.map((number) => ({
      accountId: account.id,
      accountName: account.friendlyName,
      ...number,
    })),
  );
  const phoneContacts = contacts.filter((contact) => contact.phone);
  const emailContacts = contacts.filter((contact) => contact.email);

  async function loadOlder() {
    if (!nextBefore) return;
    stickToBottom.current = false;
    const result = await getInboxTimeline(token, conversationId, nextBefore);
    setMessages((current) => {
      const seen = new Set(current.map((message) => message.id));
      return [...result.messages.filter((message) => !seen.has(message.id)), ...current];
    });
    setHasMore(result.hasMore);
    setNextBefore(result.nextBefore);
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || sending) return;
    setSending(true);
    setError(null);
    try {
      if (channel === "email") {
        await sendInboxEmail(token, conversationId, {
          body,
          subject,
          emailAccountId: emailAccountId || undefined,
          contactId: contactId || undefined,
          templateId: templateId || undefined,
        });
      } else {
        const chosen = numbers.find((number) => number.phoneNumber === fromNumber);
        await sendInboxSms(token, conversationId, {
          body,
          templateId: templateId || undefined,
          contactId: contactId || undefined,
          fromNumber: fromNumber || undefined,
          twilioAccountId: chosen?.accountId,
        });
      }
      setBody("");
      setSubject("");
      stickToBottom.current = true;
      onActivity();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function onCall() {
    setError(null);
    try {
      const chosen = numbers.find((number) => number.phoneNumber === fromNumber);
      await callInboxConversation(token, conversationId, {
        contactId: contactId || undefined,
        fromNumber: fromNumber || undefined,
        twilioAccountId: chosen?.accountId,
      });
      stickToBottom.current = true;
      onActivity();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Call failed");
    }
  }

  async function onDone() {
    if (conversation && onAction) {
      onAction("done", conversation);
      setMenuOpen(false);
      return;
    }
    try {
      const result =
        conversation?.status === "closed"
          ? await reopenInboxConversation(token, conversationId)
          : await closeInboxConversation(token, conversationId);
      setConversation(result.conversation);
      onConversation(result.conversation);
      onActivity();
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the conversation");
    }
  }

  const subtitle = conversation?.phone || conversation?.email || "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--staff-canvas)]">
      <header className="flex items-center gap-2 border-b border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)] lg:hidden"
          aria-label="Back to conversations"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--staff-ink)]">
            {conversation?.displayName || "Conversation"}
          </p>
          <p className="truncate text-xs text-[var(--staff-muted)]">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onCall}
          disabled={!canWrite || !conversation?.phone}
          className="rounded p-1.5 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)] disabled:opacity-40"
          aria-label="Call"
        >
          <Phone className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={!canWrite}
          className="rounded p-1.5 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)] disabled:opacity-40"
          aria-label={conversation?.status === "closed" ? "Reopen" : "Mark done"}
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          className="rounded p-1.5 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
          aria-label="Search conversation"
        >
          <Search className="h-4 w-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded p-1.5 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
            aria-label="More"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] py-1 shadow-lg">
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                onClick={() => {
                  if (subtitle) void navigator.clipboard?.writeText(subtitle);
                  setMenuOpen(false);
                }}
              >
                Copy {conversation?.phone ? "phone" : "address"}
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                onClick={onDone}
              >
                {conversation?.status === "closed" ? "Reopen" : "Mark done"}
              </button>
              {canTasks && conversation ? (
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                  onClick={() => {
                    onAction?.("task", conversation);
                    setMenuOpen(false);
                  }}
                >
                  Create task
                </button>
              ) : null}
              {canWrite && conversation ? (
                <>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={() => {
                      onAction?.("pin", conversation);
                      setMenuOpen(false);
                    }}
                  >
                    {conversation.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={() => {
                      onAction?.("block", conversation);
                      setMenuOpen(false);
                    }}
                  >
                    {conversation.blocked ? "Unblock" : "Block"}
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-[var(--staff-cream)]"
                    onClick={() => {
                      onAction?.("delete", conversation);
                      setMenuOpen(false);
                    }}
                  >
                    Delete conversation
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {searchOpen ? (
        <input
          value={threadQuery}
          onChange={(event) => setThreadQuery(event.target.value)}
          placeholder="Search this conversation"
          className="border-b border-[var(--staff-border)] bg-[var(--staff-surface)] px-4 py-2 text-sm text-[var(--staff-ink)] outline-none"
        />
      ) : null}
      <div
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {hasMore ? (
          <button
            type="button"
            onClick={() => void loadOlder()}
            className="mx-auto block text-xs font-medium text-[#2f6fed]"
          >
            Load earlier
          </button>
        ) : null}
        {loading ? (
          <p className="text-center text-sm text-[var(--staff-muted)]">Loading…</p>
        ) : null}
        {visible.map((message, index) => {
          const previous = visible[index - 1];
          const showDay =
            !previous || dayLabel(previous.at) !== dayLabel(message.at);
          return (
            <div key={message.id}>
              {showDay ? (
                <p className="py-2 text-center text-[11px] text-[var(--staff-muted)]">
                  {dayLabel(message.at)}
                </p>
              ) : null}
              <MessageCard
                message={message}
                token={token}
                conversationId={conversationId}
                customerId={conversation?.customerId || undefined}
                displayName={conversation?.displayName || "customer"}
                canWrite={canWrite}
                canTasks={canTasks}
                onMessage={(patch) =>
                  setMessages((current) =>
                    current.map((item) => (item.id === message.id ? { ...item, ...patch } : item)),
                  )
                }
                expanded={Boolean(expanded[message.id])}
                onToggle={() =>
                  setExpanded((current) => ({
                    ...current,
                    [message.id]: !current[message.id],
                  }))
                }
              />
            </div>
          );
        })}
        {conversation?.readByName ? (
          <p className="text-center text-[11px] text-[var(--staff-muted)]">
            Read by {conversation.readByName}
            {conversation.readAt ? ` · ${clockTime(conversation.readAt)}` : ""}
          </p>
        ) : null}
      </div>
      {error ? <p className="px-4 pb-1 text-xs text-red-500">{error}</p> : null}
      {canWrite ? (
        <form
          onSubmit={onSend}
          className="border-t border-[var(--staff-border)] bg-[var(--staff-surface)] p-3"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-[var(--staff-cream)] p-0.5">
              <button
                type="button"
                onClick={() => setChannel("sms")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                  channel === "sms"
                    ? "bg-[var(--staff-surface)] text-[var(--staff-ink)]"
                    : "text-[var(--staff-muted)]"
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                SMS
              </button>
              <button
                type="button"
                onClick={() => setChannel("email")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                  channel === "email"
                    ? "bg-[var(--staff-surface)] text-[var(--staff-ink)]"
                    : "text-[var(--staff-muted)]"
                }`}
              >
                <Mail className="h-3 w-3" />
                Email
              </button>
            </div>
            {channel === "sms" && numbers.length > 0 ? (
              <select
                value={fromNumber}
                onChange={(event) => setFromNumber(event.target.value)}
                className="w-36 rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-[11px] text-[var(--staff-ink)]"
              >
                {numbers.map((number) => (
                  <option key={number.phoneNumber} value={number.phoneNumber}>
                    {number.label || number.phoneNumber}
                  </option>
                ))}
              </select>
            ) : null}
            {channel === "email" ? (
              <select
                value={emailAccountId}
                onChange={(event) => setEmailAccountId(event.target.value)}
                className="max-w-[16rem] rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-[11px] text-[var(--staff-ink)]"
              >
                <option value="">Email account</option>
                {(channels?.emailAccounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.fromName} · {account.fromEmail}
                  </option>
                ))}
              </select>
            ) : null}
            {(channel === "sms" ? phoneContacts : emailContacts).length > 1 ? (
              <select
                value={contactId}
                onChange={(event) => setContactId(event.target.value)}
                className="max-w-[12rem] rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-[11px] text-[var(--staff-ink)]"
              >
                <option value="">Primary contact</option>
                {(channel === "sms" ? phoneContacts : emailContacts).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} · {channel === "sms" ? contact.phone : contact.email}
                  </option>
                ))}
              </select>
            ) : null}
            {templates.length > 0 ? (
              <select
                value={templateId}
                onChange={(event) => {
                  const id = event.target.value;
                  setTemplateId(id);
                  const template = templates.find((item) => item.id === id);
                  if (!template) return;
                  if (!body.trim()) setBody(template.body);
                  if (channel === "email" && !subject.trim()) setSubject(template.subject);
                }}
                className="max-w-[12rem] rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-[11px] text-[var(--staff-ink)]"
              >
                <option value="">Template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {channel === "email" ? (
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              className="mb-2 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
            />
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={2}
              placeholder={channel === "email" ? "Write an email…" : "Write a message…"}
              className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-[#2f6fed] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function MessageCard({
  message,
  token,
  conversationId,
  customerId,
  displayName,
  canWrite,
  canTasks,
  onMessage,
  expanded,
  onToggle,
}: {
  message: InboxTimelineMessage;
  token: string;
  conversationId: string;
  customerId?: string;
  displayName: string;
  canWrite: boolean;
  canTasks: boolean;
  onMessage: (patch: Partial<InboxTimelineMessage>) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const outbound = message.direction === "outbound";
  if (message.channel === "voice") {
    const recording = crmPlaybackSrc(message.mediaUrls[0]);
    return (
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--staff-muted)]">
          <span className="inline-flex items-center gap-1">
            <Phone className="h-3 w-3" />
            {outbound ? "You called" : "Called you"}
            {message.durationSeconds != null
              ? ` · ${formatDuration(message.durationSeconds)}`
              : ""}
          </span>
          <span>{clockTime(message.at)}</span>
        </div>
        {recording ? <audio controls src={recording} className="mt-2 w-full" /> : null}
        <CallFollowUp
          token={token}
          message={message}
          conversationId={conversationId}
          customerId={customerId}
          displayName={displayName}
          canWrite={canWrite}
          canTasks={canTasks}
          onChange={onMessage}
        />
      </div>
    );
  }
  if (message.channel === "email") {
    return (
      <article className="rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--staff-muted)]">
              {outbound ? message.senderName || "You" : message.senderName || message.from} ·{" "}
              {clockTime(message.at)}
            </p>
            <h3 className="truncate text-sm font-semibold text-[var(--staff-ink)]">
              {message.subject || "(no subject)"}
            </h3>
          </div>
          <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--staff-muted)]" />
        </div>
        {expanded && message.html ? (
          <div
            className="mt-2 max-h-80 max-w-none overflow-auto rounded-md bg-white px-3 py-2 text-sm text-neutral-900 [&_a]:underline [&_img]:max-w-full [&_style]:hidden"
            dangerouslySetInnerHTML={{ __html: emailDisplayHtml(message.html) }}
          />
        ) : (
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--staff-ink)]">
            {emailPlainText(message.body) || emailPlainText(message.html) || "(empty)"}
          </p>
        )}
        {message.html || message.body.length > 180 ? (
          <button
            type="button"
            onClick={onToggle}
            className="mt-1 text-[11px] font-medium text-[#2f6fed]"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
        {message.attachments.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {message.attachments.map((file) => (
              <li key={`${file.partId}-${file.filename}`} className="text-[11px] text-[var(--staff-muted)]">
                {file.filename}
                {file.size ? ` · ${Math.max(1, Math.round(file.size / 1024))} KB` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    );
  }
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${
          outbound
            ? "rounded-br-md bg-[#2f6fed] text-white"
            : "rounded-bl-md bg-[var(--staff-cream)] text-[var(--staff-ink)]"
        }`}
      >
        {message.senderName ? (
          <p className={`mb-0.5 text-[10px] ${outbound ? "text-white/80" : "text-[var(--staff-muted)]"}`}>
            {message.senderName}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap">{message.body || (message.mediaUrls.length ? "" : "")}</p>
        {message.mediaUrls.length > 0 ? (
          <div className="mt-2 space-y-1">
            {message.mediaUrls.map((url) =>
              isImage(url) ? (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {/* Remote MMS URLs are not on the image optimizer allow list. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="max-h-40 rounded-md" />
                </a>
              ) : (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] underline"
                >
                  Attachment
                </a>
              ),
            )}
          </div>
        ) : null}
        <p className={`mt-1 text-[10px] ${outbound ? "text-white/70" : "text-[var(--staff-muted)]"}`}>
          {clockTime(message.at)}
          {message.status === "failed" ? " · Failed" : ""}
        </p>
      </div>
    </div>
  );
}
