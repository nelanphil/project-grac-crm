"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import EmailReplyComposer from "@/components/messaging/EmailReplyComposer";
import EmailStaffTags from "@/components/messaging/EmailStaffTags";
import EmailPreview from "./EmailPreview";
import {
  ApiError,
  EmailAccountItem,
  MailboxAddress,
  MailboxCustomerLink,
  MailboxFolder,
  MailboxMessageDetail,
  MailboxMessageSummary,
  MailboxReplyMode,
  MailboxThreadMessage,
  UserListItem,
  getEmailAccounts,
  getMailboxMessages,
  getMailboxThread,
  getUsers,
  locateMailboxMessage,
  replyToMailboxMessage,
  setMailboxAssignees,
  setMailboxMessageArchived,
  updateEmailAccount,
} from "@/lib/api";
import { formatAddressList, isMailDeliverySubsystem } from "@/lib/mailboxReply";

type EmailInboxPanelProps = {
  token: string;
  initialAccountId?: string;
  initialFolder?: MailboxFolder;
  initialUid?: number | null;
  initialMessageId?: string;
};

type DeepLink = {
  accountId: string;
  folder: MailboxFolder;
  uid: number | null;
  messageId: string;
  applied: boolean;
};

function positiveUid(uid: number | null | undefined): number | null {
  return uid && uid > 0 ? uid : null;
}

function deepLinkFromProps(
  accountId: string,
  folder: MailboxFolder,
  uid: number | null | undefined,
  messageId: string | undefined,
): DeepLink {
  const resolvedUid = positiveUid(uid);
  const resolvedMessageId = resolvedUid ? "" : (messageId ?? "").trim();
  return {
    accountId,
    folder,
    uid: resolvedUid,
    messageId: resolvedMessageId,
    applied: !(accountId && (resolvedUid || resolvedMessageId)),
  };
}

function deepLinkKey(link: DeepLink): string {
  if (!link.accountId || (!link.uid && !link.messageId)) return "";
  return `${link.accountId}:${link.folder}:${link.uid ?? ""}:${link.messageId}`;
}

function formatWhen(value: string | null, style: "short" | "full" = "short"): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (style === "full") {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function formatDisconnectedNames(accounts: { friendlyName: string }[]): string {
  const names = accounts.map((account) => account.friendlyName);
  if (names.length <= 1) return names[0] ?? "This account";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function threadKeyOf(message: MailboxMessageSummary): string {
  return message.threadKey || `uid:${message.uid}`;
}

function byNewest(left: MailboxMessageSummary, right: MailboxMessageSummary): number {
  const leftTime = left.date ? new Date(left.date).getTime() : 0;
  const rightTime = right.date ? new Date(right.date).getTime() : 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return right.uid - left.uid;
}

function groupThreads(messages: MailboxMessageSummary[]): MailboxMessageSummary[][] {
  const order: string[] = [];
  const groups = new Map<string, MailboxMessageSummary[]>();
  for (const message of messages) {
    const key = threadKeyOf(message);
    const group = groups.get(key);
    if (group) {
      group.push(message);
    } else {
      groups.set(key, [message]);
      order.push(key);
    }
  }
  return order.map((key) => [...(groups.get(key) ?? [])].sort(byNewest));
}

function partyAddresses(
  folder: MailboxFolder,
  message: { from: MailboxAddress[]; to: MailboxAddress[] },
): MailboxAddress[] {
  return folder === "sent" ? message.to : message.from;
}

function partyName(addresses: MailboxAddress[]): string {
  if (addresses.length === 0) return "Unknown";
  const first = addresses[0];
  const name = first?.name?.trim();
  const label = name || first?.address || "Unknown";
  return addresses.length > 1 ? `${label} +${addresses.length - 1}` : label;
}

function partyInitial(addresses: MailboxAddress[]): string {
  const label = partyName(addresses).replace(/\s+\+\d+$/, "");
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 1).toUpperCase() || "?";
}

function partyEmail(addresses: MailboxAddress[]): string {
  return addresses[0]?.address ?? "";
}

function toDetail(message: MailboxThreadMessage): MailboxMessageDetail | null {
  if (message.uid == null) return null;
  return {
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
    threadKey: "",
    messageKey: message.messageKey,
    assignees: message.assignees,
    customer: message.customer,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
    references: message.references,
    archived: message.archived,
  };
}

function CustomerName({
  name,
  customer,
  className,
}: {
  name: string;
  customer: MailboxCustomerLink | null | undefined;
  className: string;
}) {
  if (!customer) return <span className={className}>{name}</span>;
  return (
    <Link
      href={`/dashboard/customers/detail?id=${customer.id}`}
      title={`Open ${customer.name}`}
      onClick={(event) => event.stopPropagation()}
      className={`${className} hover:underline`}
    >
      {name}
    </Link>
  );
}

export default function EmailInboxPanel({
  token,
  initialAccountId = "",
  initialFolder = "inbox",
  initialUid = null,
  initialMessageId = "",
}: EmailInboxPanelProps) {
  const openingFromMessageId = Boolean(
    initialAccountId && initialMessageId.trim() && !positiveUid(initialUid),
  );
  const [accounts, setAccounts] = useState<EmailAccountItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState<MailboxFolder>(initialFolder);
  const [messages, setMessages] = useState<MailboxMessageSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(
    openingFromMessageId ? "opening" : null,
  );
  const [focusedUid, setFocusedUid] = useState<number | null>(null);
  const [thread, setThread] = useState<MailboxThreadMessage[] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [openingLink, setOpeningLink] = useState(openingFromMessageId);
  const [listAttempt, setListAttempt] = useState(0);
  const [locateAttempt, setLocateAttempt] = useState(0);
  const [threadAttempt, setThreadAttempt] = useState(0);
  const [staff, setStaff] = useState<UserListItem[]>([]);
  const [taggingOpen, setTaggingOpen] = useState(false);
  const [savingAssigneeUid, setSavingAssigneeUid] = useState<number | null>(null);
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<MailboxReplyMode | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const [savingAutoReply, setSavingAutoReply] = useState(false);
  const [autoReplyError, setAutoReplyError] = useState<string | null>(null);
  const [deliverySubsystemOnly, setDeliverySubsystemOnly] = useState(false);
  const [showArchivedOnly, setShowArchivedOnly] = useState(false);
  const [archivingUids, setArchivingUids] = useState<Set<number>>(new Set());
  const [expandedQuotedKeys, setExpandedQuotedKeys] = useState<Set<string>>(
    new Set(),
  );
  const deepLinkRef = useRef<DeepLink>(
    deepLinkFromProps(initialAccountId, initialFolder, initialUid, initialMessageId),
  );
  const incomingLink = deepLinkKey(
    deepLinkFromProps(initialAccountId, initialFolder, initialUid, initialMessageId),
  );
  const [appliedLink, setAppliedLink] = useState(incomingLink);
  useEffect(() => {
    if (incomingLink && incomingLink !== appliedLink) {
      const next = deepLinkFromProps(
        initialAccountId,
        initialFolder,
        initialUid,
        initialMessageId,
      );
      queueMicrotask(() => {
        setAppliedLink(incomingLink);
        setAccountId(initialAccountId);
        setFolder(initialFolder);
        setLinkError(null);
        setOpeningLink(Boolean(next.messageId));
        setSelectedThreadKey(next.messageId ? "opening" : null);
        deepLinkRef.current = next;
      });
    }
  }, [
    incomingLink,
    appliedLink,
    initialAccountId,
    initialFolder,
    initialUid,
    initialMessageId,
  ]);

  useEffect(() => {
    let cancelled = false;
    getEmailAccounts(token)
      .then(({ accounts: list }) => {
        if (cancelled) return;
        const active = list.filter((account) => account.isActive);
        setAccounts(active);
        const preferred = active.find(
          (account) =>
            account._id === initialAccountId && account.imapHost?.trim(),
        );
        const firstConnected = active.find((account) => account.imapHost?.trim());
        setAccountId(preferred?._id ?? firstConnected?._id ?? active[0]?._id ?? "");
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, initialAccountId]);

  useEffect(() => {
    let cancelled = false;
    getUsers(token)
      .then(({ users }) => {
        if (cancelled) return;
        setStaff(users.filter((user) => user.userType !== "customer"));
      })
      .catch(() => {
        if (!cancelled) setStaff([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account._id === accountId) ?? null,
    [accounts, accountId],
  );
  const mailboxReady = Boolean(selectedAccount?.imapHost?.trim());
  const allThreads = useMemo(() => groupThreads(messages), [messages]);

  const isGroupArchived = (group: MailboxMessageSummary[]) =>
    group.some((message) => Boolean(message.archived));

  const archivedCount = useMemo(
    () => allThreads.filter(isGroupArchived).length,
    [allThreads],
  );

  const deliverySubsystemCount = useMemo(
    () =>
      allThreads
        .filter((group) => !isGroupArchived(group))
        .filter((group) =>
          group.some((message) => isMailDeliverySubsystem(message)),
        ).length,
    [allThreads],
  );

  const threads = useMemo(() => {
    if (folder !== "inbox") return allThreads;
    if (showArchivedOnly) {
      return allThreads.filter(isGroupArchived);
    }
    const activeThreads = allThreads.filter((group) => !isGroupArchived(group));
    if (deliverySubsystemOnly) {
      return activeThreads.filter((group) =>
        group.some((message) => isMailDeliverySubsystem(message)),
      );
    }
    return activeThreads.filter(
      (group) => !group.some((message) => isMailDeliverySubsystem(message)),
    );
  }, [allThreads, folder, showArchivedOnly, deliverySubsystemOnly]);

  useEffect(() => {
    if (!selectedThreadKey || selectedThreadKey === "opening") return;
    const isVisible = threads.some((group) => {
      const latest = group[0];
      return latest && threadKeyOf(latest) === selectedThreadKey;
    });
    if (!isVisible) {
      queueMicrotask(() => {
        if (threads.length > 0 && threads[0]?.[0]) {
          const first = threads[0][0];
          setSelectedThreadKey(threadKeyOf(first));
          setFocusedUid(first.uid);
        } else {
          setSelectedThreadKey(null);
          setFocusedUid(null);
        }
      });
    }
  }, [threads, selectedThreadKey]);

  useEffect(() => {
    const link = deepLinkRef.current;
    const locating = Boolean(link.messageId && !link.uid && !link.applied);
    if (!mailboxReady || !accountId) {
      queueMicrotask(() => {
        setMessages([]);
        setListError(null);
        if (!locating) {
          setSelectedThreadKey(null);
          setFocusedUid(null);
          setThread(null);
        }
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setLoadingMessages(true);
      setListError(null);
      if (!locating) {
        setSelectedThreadKey(null);
        setFocusedUid(null);
        setThread(null);
        setThreadError(null);
        setComposeMode(null);
        setReplyNotice(null);
        setTaggingOpen(false);
      }
    });
    getMailboxMessages(token, accountId, folder)
      .then(({ messages: list }) => {
        if (cancelled) return;
        setMessages(list);
        const pending = deepLinkRef.current;
        if (
          !pending.applied &&
          pending.uid &&
          accountId === pending.accountId &&
          folder === pending.folder
        ) {
          const match = list.find((message) => message.uid === pending.uid);
          setSelectedThreadKey(
            match ? threadKeyOf(match) : `uid:${folder}:${pending.uid}`,
          );
          setFocusedUid(pending.uid);
          pending.applied = true;
          setOpeningLink(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setListError(
          err instanceof ApiError ? err.message : "Could not load this mailbox.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, accountId, folder, mailboxReady, listAttempt, locateAttempt]);

  useEffect(() => {
    const link = deepLinkRef.current;
    if (link.applied || !link.messageId || link.uid) return;
    if (loadingAccounts) return;
    const connected = accounts.some(
      (account) => account._id === link.accountId && account.imapHost?.trim(),
    );
    if (!connected || accountId !== link.accountId) {
      if (!connected) {
        link.applied = true;
        link.messageId = "";
        setOpeningLink(false);
        setLinkError("This email is not in the connected mailbox.");
        setSelectedThreadKey("missing");
      }
      return;
    }
    if (!mailboxReady) return;

    let cancelled = false;
    queueMicrotask(() => {
      setOpeningLink(true);
      setLinkError(null);
      setSelectedThreadKey("opening");
    });
    locateMailboxMessage(token, link.accountId, link.messageId)
      .then((found) => {
        if (cancelled || deepLinkRef.current.applied) return;
        link.uid = found.uid;
        link.folder = found.folder;
        link.messageId = "";
        if (found.folder !== folder) {
          setFolder(found.folder);
          return;
        }
        setLocateAttempt((attempt) => attempt + 1);
      })
      .catch((err) => {
        if (cancelled || deepLinkRef.current.applied) return;
        link.applied = true;
        link.messageId = "";
        setOpeningLink(false);
        setLinkError(
          err instanceof ApiError
            ? err.status === 404
              ? "This email is not in the connected mailbox."
              : err.message
            : "Could not open this email.",
        );
        setSelectedThreadKey("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [
    token,
    mailboxReady,
    accountId,
    folder,
    appliedLink,
    loadingAccounts,
    accounts,
  ]);

  useEffect(() => {
    if (!mailboxReady || !accountId || focusedUid == null) {
      queueMicrotask(() => setThread(null));
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setLoadingThread(true);
      setThreadError(null);
      setComposeMode(null);
    });
    getMailboxThread(token, accountId, focusedUid, folder)
      .then(({ messages: list }) => {
        if (cancelled) return;
        setThread(list);
        const seenUids = new Set(
          list
            .filter(
              (message) =>
                message.seen && message.uid != null && message.folder === folder,
            )
            .map((message) => message.uid),
        );
        if (seenUids.size > 0) {
          setMessages((current) =>
            current.map((row) =>
              seenUids.has(row.uid) ? { ...row, seen: true } : row,
            ),
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setThread(null);
        setThreadError(
          err instanceof ApiError ? err.message : "Could not open this thread.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, accountId, folder, focusedUid, mailboxReady, threadAttempt]);

  const replyTarget = useMemo(() => {
    if (!thread) return null;
    const focused = thread.find(
      (message) =>
        message.source === "imap" &&
        message.uid === focusedUid &&
        message.folder === folder,
    );
    if (focused?.uid != null) return focused;
    return (
      [...thread]
        .reverse()
        .find(
          (message) =>
            message.source === "imap" &&
            message.uid != null &&
            message.folder === folder,
        ) ?? null
    );
  }, [thread, focusedUid, folder]);
  const replyDetail = replyTarget ? toDetail(replyTarget) : null;
  const focusedMessage =
    thread?.find(
      (message) => message.uid === focusedUid && message.folder === folder,
    ) ??
    thread?.[thread.length - 1] ??
    null;

  async function handleAssignees(
    target: { uid: number; folder: MailboxFolder },
    userIds: string[],
  ) {
    setSavingAssigneeUid(target.uid);
    setAssigneeError(null);
    try {
      const result = await setMailboxAssignees(token, accountId, target.uid, {
        folder: target.folder,
        userIds,
      });
      setMessages((current) =>
        current.map((message) =>
          message.uid === target.uid
            ? {
                ...message,
                assignees: result.assignees,
                messageKey: result.messageKey,
              }
            : message,
        ),
      );
      setThread(
        (current) =>
          current?.map((message) =>
            message.uid === target.uid && message.folder === target.folder
              ? {
                  ...message,
                  assignees: result.assignees,
                  messageKey: result.messageKey,
                }
              : message,
          ) ?? null,
      );
    } catch (err) {
      setAssigneeError(
        err instanceof ApiError ? err.message : "Could not update staff tags.",
      );
    } finally {
      setSavingAssigneeUid(null);
    }
  }

  async function handleToggleArchive(
    target: MailboxMessageSummary | MailboxThreadMessage,
    nextArchived: boolean,
  ) {
    if (target.uid == null) return;
    const uid = target.uid;
    const targetFolder = "folder" in target ? target.folder : folder;
    setArchivingUids((prev) => new Set(prev).add(uid));

    // Optimistically update
    setMessages((prev) =>
      prev.map((msg) =>
        msg.uid === uid ? { ...msg, archived: nextArchived } : msg,
      ),
    );
    setThread((prev) =>
      prev?.map((msg) =>
        msg.uid === uid ? { ...msg, archived: nextArchived } : msg,
      ) ?? null,
    );

    try {
      await setMailboxMessageArchived(token, accountId, uid, {
        folder: targetFolder,
        archived: nextArchived,
      });
    } catch (err) {
      // Rollback on error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.uid === uid ? { ...msg, archived: !nextArchived } : msg,
        ),
      );
      setThread((prev) =>
        prev?.map((msg) =>
          msg.uid === uid ? { ...msg, archived: !nextArchived } : msg,
        ) ?? null,
      );
      console.error("Could not update archive state", err);
    } finally {
      setArchivingUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  }

  async function handleSendReply(input: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    html: string;
    useBrandTemplate: boolean;
  }) {
    if (!replyTarget?.uid || !composeMode) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const result = await replyToMailboxMessage(
        token,
        accountId,
        replyTarget.uid,
        {
          folder: replyTarget.folder,
          mode: composeMode,
          ...input,
        },
      );
      setComposeMode(null);
      setReplyNotice(
        result.savedToSent
          ? "Email sent."
          : "Email sent, but it could not be saved to the Sent folder.",
      );
      setThreadAttempt((attempt) => attempt + 1);
    } catch (err) {
      setReplyError(
        err instanceof ApiError ? err.message : "Could not send this email.",
      );
    } finally {
      setSendingReply(false);
    }
  }

  async function handleAutoAcknowledge(enabled: boolean) {
    if (!selectedAccount) return;
    setSavingAutoReply(true);
    setAutoReplyError(null);
    try {
      const { account } = await updateEmailAccount(token, selectedAccount._id, {
        autoAcknowledge: enabled,
      });
      setAccounts((current) =>
        current.map((item) => (item._id === account._id ? account : item)),
      );
    } catch (err) {
      setAutoReplyError(
        err instanceof ApiError
          ? err.message
          : "Could not update automatic reply.",
      );
    } finally {
      setSavingAutoReply(false);
    }
  }

  function abandonDeepLink() {
    deepLinkRef.current.applied = true;
    deepLinkRef.current.messageId = "";
    setOpeningLink(false);
    setLinkError(null);
  }

  function selectThread(group: MailboxMessageSummary[]) {
    const latest = group[0];
    if (!latest) return;
    abandonDeepLink();
    setSelectedThreadKey(threadKeyOf(latest));
    setFocusedUid(latest.uid);
    setTaggingOpen(false);
    setReplyNotice(null);
    setReplyError(null);
  }

  const disconnected = accounts.filter((account) => !account.imapHost?.trim());
  const readingMessages = thread ? [...thread].reverse() : [];

  return (
    <section className="flex min-h-[36rem] flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm md:h-[calc(100dvh-14rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--staff-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          {(["inbox", "sent"] as const).map((value) => {
            const active = folder === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  abandonDeepLink();
                  setFolder(value);
                  setDeliverySubsystemOnly(false);
                  setShowArchivedOnly(false);
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  active
                    ? "bg-brand-dark text-white"
                    : "text-neutral-600 hover:bg-[var(--staff-cream)]"
                }`}
              >
                {value === "inbox" ? "Inbox" : "Sent"}
              </button>
            );
          })}
          <label
            className="ml-1 flex items-center gap-1.5 text-[11px] text-neutral-600"
            title="When this is on, new emails get a short note that we received them and someone will respond soon. Mail already in the inbox is left alone."
          >
            <input
              type="checkbox"
              className="accent-brand-orange"
              checked={Boolean(selectedAccount?.autoAcknowledge)}
              disabled={!selectedAccount?.imapHost?.trim() || savingAutoReply}
              onChange={(event) =>
                void handleAutoAcknowledge(event.target.checked)
              }
            />
            Automatic reply
          </label>
          {folder === "inbox" ? (
            <>
              <label
                className="ml-2 flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer select-none"
                title="Show only automated Mail Delivery Subsystem and delivery status failure notices"
              >
                <input
                  type="checkbox"
                  className="accent-brand-orange cursor-pointer"
                  checked={deliverySubsystemOnly}
                  disabled={showArchivedOnly}
                  onChange={(event) =>
                    setDeliverySubsystemOnly(event.target.checked)
                  }
                />
                <span>Mail Delivery Subsystem</span>
                {deliverySubsystemCount > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                      deliverySubsystemOnly
                        ? "bg-brand-orange text-white"
                        : "bg-neutral-200 text-neutral-600"
                    }`}
                  >
                    {deliverySubsystemCount}
                  </span>
                ) : null}
              </label>

              <label
                className="ml-2 flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer select-none"
                title="View archived email messages"
              >
                <input
                  type="checkbox"
                  className="accent-brand-orange cursor-pointer"
                  checked={showArchivedOnly}
                  onChange={(event) => {
                    setShowArchivedOnly(event.target.checked);
                    if (event.target.checked) {
                      setDeliverySubsystemOnly(false);
                    }
                  }}
                />
                <span>Archived</span>
                {archivedCount > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                      showArchivedOnly
                        ? "bg-brand-orange text-white"
                        : "bg-neutral-200 text-neutral-600"
                    }`}
                  >
                    {archivedCount}
                  </span>
                ) : null}
              </label>
            </>
          ) : null}
        </div>
        {accounts.length > 0 ? (
          <select
            value={accountId}
            onChange={(event) => {
              abandonDeepLink();
              setAccountId(event.target.value);
            }}
            className="max-w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-[11px] text-neutral-600 outline-none focus:border-brand-orange"
          >
            {accounts.map((account) => (
              <option
                key={account._id}
                value={account._id}
                disabled={!account.imapHost?.trim()}
              >
                {account.friendlyName} ({account.fromEmail})
                {account.imapHost?.trim() ? "" : " — not connected"}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {autoReplyError ? (
        <p className="border-b border-[var(--staff-border)] px-3 py-1.5 text-[11px] text-red-700">
          {autoReplyError}
        </p>
      ) : null}

      {loadingAccounts ? (
        <div className="flex items-center gap-2 p-4 text-xs text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading email accounts…
        </div>
      ) : accounts.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">
          No active email accounts. Add one in{" "}
          <Link href="/dashboard/control-panel" className="text-brand-dark underline">
            Control Panel
          </Link>
          .
        </p>
      ) : !mailboxReady ? (
        <p className="p-4 text-sm text-neutral-500">
          This account is not connected to a mailbox. Add an IMAP host on the
          email account in{" "}
          <Link href="/dashboard/control-panel" className="text-brand-dark underline">
            Control Panel
          </Link>
          .
        </p>
      ) : (
        <>
          {disconnected.length > 0 ? (
            <p className="border-b border-[var(--staff-border)] px-3 py-2 text-[11px] text-neutral-500">
              {formatDisconnectedNames(disconnected)}{" "}
              {disconnected.length === 1 ? "is" : "are"} not connected. Add an
              IMAP host in{" "}
              <Link
                href="/dashboard/control-panel"
                className="text-brand-dark underline"
              >
                Control Panel
              </Link>
              .
            </p>
          ) : null}
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
            <div
              className={`min-h-0 overflow-y-auto border-[var(--staff-border)] md:border-r ${
                selectedThreadKey != null ? "hidden md:block" : "block"
              }`}
            >
              {loadingMessages ? (
                <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : listError ? (
                <div className="space-y-2 p-3">
                  <p className="text-xs text-red-700">{listError}</p>
                  <button
                    type="button"
                    onClick={() => setListAttempt((attempt) => attempt + 1)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-[var(--staff-cream)]"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {folder === "inbox" && showArchivedOnly ? (
                    <div className="flex items-center justify-between border-b border-[var(--staff-border)] bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-950">
                      <span className="font-medium">
                        Showing {archivedCount} archived {archivedCount === 1 ? "email" : "emails"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowArchivedOnly(false)}
                        className="font-semibold text-brand-orange hover:underline ml-2"
                      >
                        Back to Inbox
                      </button>
                    </div>
                  ) : folder === "inbox" && deliverySubsystemCount > 0 ? (
                    <div
                      className={`flex items-center justify-between border-b border-[var(--staff-border)] px-3 py-1.5 text-[11px] ${
                        deliverySubsystemOnly
                          ? "bg-amber-50 text-amber-900"
                          : "bg-[var(--staff-cream)] text-neutral-600"
                      }`}
                    >
                      <span>
                        {deliverySubsystemOnly
                          ? `Showing ${deliverySubsystemCount} Mail Delivery Subsystem ${
                              deliverySubsystemCount === 1 ? "notice" : "notices"
                            }`
                          : `${deliverySubsystemCount} Mail Delivery Subsystem ${
                              deliverySubsystemCount === 1 ? "notice" : "notices"
                            } hidden`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDeliverySubsystemOnly((current) => !current)
                        }
                        className="font-semibold text-brand-orange hover:underline ml-2"
                      >
                        {deliverySubsystemOnly ? "Show Inbox" : "Show"}
                      </button>
                    </div>
                  ) : null}

                  {threads.length === 0 ? (
                    <p className="p-3 text-xs text-neutral-500">
                      {folder === "inbox"
                        ? showArchivedOnly
                          ? "No archived emails."
                          : deliverySubsystemOnly
                            ? "No Mail Delivery Subsystem messages in inbox."
                            : "Inbox is empty."
                        : "No sent mail in this folder."}
                    </p>
                  ) : (
                    <ul>
                      {threads.map((group) => {
                        const latest = group[0];
                        if (!latest) return null;
                        const key = threadKeyOf(latest);
                        const active = selectedThreadKey === key;
                        const unread = group.some((message) => !message.seen);
                        const who = partyAddresses(folder, latest);
                        const customer = latest.customer ?? null;
                        const isArchived = Boolean(latest.archived);
                        return (
                          <li
                            key={key}
                            className={`border-b border-[var(--staff-border)] ${
                              active
                                ? "conversation-row-active border-l-2 border-l-brand-orange"
                                : ""
                            }`}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => selectThread(group)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  selectThread(group);
                                }
                              }}
                              className={`group flex w-full gap-2.5 px-3 py-2.5 text-left ${
                                active ? "" : "hover:bg-[var(--staff-cream)]"
                              }`}
                            >
                              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-midnight text-[11px] font-semibold text-white">
                                {partyInitial(who)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                  <CustomerName
                                    name={partyName(who)}
                                    customer={customer}
                                    className={`truncate text-[13px] text-[var(--staff-ink)] ${
                                      unread ? "font-semibold" : "font-medium"
                                    }`}
                                  />
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[10px] text-neutral-400">
                                      {formatWhen(latest.date)}
                                    </span>
                                    <button
                                      type="button"
                                      title={
                                        isArchived
                                          ? "Unarchive (restore to inbox)"
                                          : "Archive email"
                                      }
                                      disabled={archivingUids.has(latest.uid)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleToggleArchive(
                                          latest,
                                          !isArchived,
                                        );
                                      }}
                                      className={`rounded p-0.5 text-neutral-400 hover:text-brand-dark hover:bg-neutral-200/70 transition-all ${
                                        archivingUids.has(latest.uid)
                                          ? "opacity-100"
                                          : "opacity-60 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                                      }`}
                                    >
                                      {archivingUids.has(latest.uid) ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : isArchived ? (
                                        <ArchiveRestore className="h-3.5 w-3.5 text-brand-orange" />
                                      ) : (
                                        <Archive className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </span>
                                </span>
                            <span
                              className={`mt-0.5 block truncate text-xs text-neutral-700 ${
                                unread ? "font-semibold" : ""
                              }`}
                            >
                              {latest.subject}
                            </span>
                            {latest.snippet ? (
                              <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                                {latest.snippet}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

            <div
              className={`min-h-[280px] min-w-0 flex-col ${
                selectedThreadKey == null ? "hidden md:flex" : "flex"
              }`}
            >
              {linkError ? (
                <p className="p-4 text-xs text-neutral-500">{linkError}</p>
              ) : openingLink && focusedUid == null ? (
                <div className="flex items-center gap-2 p-4 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Opening thread…
                </div>
              ) : focusedUid == null ? (
                <p className="p-4 text-xs text-neutral-500">
                  Select a message to read the thread.
                </p>
              ) : loadingThread ? (
                <div className="flex items-center gap-2 p-4 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Opening thread…
                </div>
              ) : threadError ? (
                <div className="space-y-2 p-4">
                  <p className="text-xs text-red-700">{threadError}</p>
                  <button
                    type="button"
                    onClick={() => setThreadAttempt((attempt) => attempt + 1)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-[var(--staff-cream)]"
                  >
                    Retry
                  </button>
                </div>
              ) : focusedMessage ? (
                <article className="flex h-full min-h-0 flex-col">
                  <header className="shrink-0 border-b border-[var(--staff-border)] px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedThreadKey(null);
                        setFocusedUid(null);
                      }}
                      className="mb-2 text-[11px] text-neutral-500 md:hidden"
                    >
                      Back to list
                    </button>
                    <h3 className="text-lg font-semibold text-[var(--staff-ink)]">
                      {focusedMessage.subject}
                    </h3>
                    {thread && thread.length > 1 ? (
                      <p className="mt-1 text-[11px] text-neutral-500">
                        {thread.length} messages in this thread
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ["reply", "Reply"],
                          ["replyAll", "Reply all"],
                          ["forward", "Forward"],
                        ] as const
                      ).map(([mode, label]) => {
                        const active = composeMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            disabled={!replyDetail}
                            onClick={() => {
                              setReplyError(null);
                              setReplyNotice(null);
                              setComposeMode(active ? null : mode);
                            }}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                              active
                                ? "bg-brand-dark text-white"
                                : "border border-[var(--staff-border)] text-neutral-700 hover:bg-[var(--staff-cream)]"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {replyTarget?.uid != null ? (
                        <button
                          type="button"
                          disabled={archivingUids.has(replyTarget.uid)}
                          onClick={() =>
                            void handleToggleArchive(
                              replyTarget,
                              !replyTarget.archived,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--staff-border)] px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-[var(--staff-cream)] transition-colors disabled:opacity-50"
                          title={
                            replyTarget.archived
                              ? "Restore to inbox"
                              : "Archive email"
                          }
                        >
                          {archivingUids.has(replyTarget.uid) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : replyTarget.archived ? (
                            <>
                              <ArchiveRestore className="h-3.5 w-3.5 text-brand-orange" />
                              Unarchive
                            </>
                          ) : (
                            <>
                              <Archive className="h-3.5 w-3.5 text-neutral-500" />
                              Archive
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                    {replyTarget?.uid != null ? (
                      <div className="mt-2">
                        <EmailStaffTags
                          staff={staff}
                          assigneeIds={replyTarget.assignees ?? []}
                          open={taggingOpen}
                          saving={savingAssigneeUid === replyTarget.uid}
                          error={taggingOpen ? assigneeError : null}
                          onToggleOpen={() => setTaggingOpen((open) => !open)}
                          onChange={(userIds) =>
                            void handleAssignees(
                              {
                                uid: replyTarget.uid as number,
                                folder: replyTarget.folder,
                              },
                              userIds,
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </header>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                    {readingMessages.map((message, index) => {
                      const who = partyAddresses(message.folder, message);
                      const focused =
                        message.uid === focusedUid && message.folder === folder;
                      const msgKey = `${message.source}-${message.folder}-${message.uid ?? message.messageId}-${index}`;
                      const hasQuotedDifference =
                        Boolean(message.html) &&
                        Boolean(message.displayHtml) &&
                        message.html.length > (message.displayHtml?.length ?? 0);
                      const isQuotedExpanded = expandedQuotedKeys.has(msgKey);
                      const rawHtml = isQuotedExpanded
                        ? message.html
                        : message.displayHtml || message.html;
                      const bodyText = message.displayText || message.text;
                      const resolvedHtml = rawHtml
                        ? rawHtml
                        : bodyText
                          ? `<pre style="font-family: inherit; white-space: pre-wrap; font-size: 14px; line-height: 1.6; color: #1a202c; padding: 16px; margin: 0;">${escapeHtml(bodyText)}</pre>`
                          : "";
                      return (
                        <section
                          key={msgKey}
                          className={`rounded-lg border px-3 py-3 ${
                            focused
                              ? "border-brand-orange bg-[var(--staff-surface)]"
                              : "border-[var(--staff-border)] bg-[var(--staff-cream)]"
                          }`}
                        >
                          <div className="flex gap-2.5">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-midnight text-[11px] font-semibold text-white">
                              {partyInitial(who)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm text-[var(--staff-ink)]">
                                    <CustomerName
                                      name={partyName(who)}
                                      customer={message.customer}
                                      className="font-semibold"
                                    />
                                    {partyEmail(who) ? (
                                      <span className="ml-1 font-normal text-neutral-500">
                                        &lt;{partyEmail(who)}&gt;
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="truncate text-[11px] text-neutral-500">
                                    To {formatAddressList(message.to)}
                                  </p>
                                  {message.cc.length > 0 ? (
                                    <p className="truncate text-[11px] text-neutral-500">
                                      Cc {formatAddressList(message.cc)}
                                    </p>
                                  ) : null}
                                </div>
                                <time className="shrink-0 text-[11px] text-neutral-400">
                                  {formatWhen(message.date, "full")}
                                </time>
                              </div>
                            </div>
                          </div>
                          {message.attachments.length > 0 ? (
                            <ul className="mt-2 space-y-0.5 pl-10 text-[11px] text-neutral-500">
                              {message.attachments.map((file, fileIndex) => (
                                <li key={`${file.filename}-${fileIndex}`}>
                                  {file.filename} · {file.contentType} ·{" "}
                                  {formatBytes(file.size)}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="mt-3">
                            <EmailPreview
                              fullWidth
                              hideHeader
                              subject={message.subject || ""}
                              html={resolvedHtml}
                              frameClassName="h-[520px] w-full border-0 bg-white"
                            />
                            {hasQuotedDifference ? (
                              <div className="mt-1 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedQuotedKeys((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(msgKey)) next.delete(msgKey);
                                      else next.add(msgKey);
                                      return next;
                                    });
                                  }}
                                  className="text-[11px] font-medium text-brand-orange hover:underline"
                                >
                                  {isQuotedExpanded
                                    ? "Hide quoted history"
                                    : "Show full email with history"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  {replyNotice ? (
                    <p className="border-t border-[var(--staff-border)] px-4 py-2 text-xs text-neutral-600">
                      {replyNotice}
                    </p>
                  ) : null}
                </article>
              ) : null}
            </div>
          </div>
        </>
      )}

      {composeMode && replyDetail ? (
        <EmailReplyComposer
          key={`${replyDetail.uid}-${replyDetail.messageKey}-${composeMode}`}
          mode={composeMode}
          folder={replyTarget?.folder ?? folder}
          detail={replyDetail}
          ownAddress={selectedAccount?.fromEmail ?? ""}
          sending={sendingReply}
          error={replyError}
          onCancel={() => setComposeMode(null)}
          onSend={(input) => void handleSendReply(input)}
        />
      ) : null}
    </section>
  );
}
