"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import EmailReplyComposer from "@/components/messaging/EmailReplyComposer";
import EmailStaffTags from "@/components/messaging/EmailStaffTags";
import {
  ApiError,
  EmailAccountItem,
  MailboxFolder,
  MailboxMessageDetail,
  MailboxMessageSummary,
  MailboxReplyMode,
  UserListItem,
  getEmailAccounts,
  getMailboxMessage,
  getMailboxMessages,
  getUsers,
  replyToMailboxMessage,
  setMailboxAssignees,
  updateEmailAccount,
} from "@/lib/api";
import { formatAddressList } from "@/lib/mailboxReply";

type EmailInboxPanelProps = {
  token: string;
  initialAccountId?: string;
  initialFolder?: MailboxFolder;
  initialUid?: number | null;
};

function formatWhen(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDisconnectedNames(
  accounts: { friendlyName: string }[],
): string {
  const names = accounts.map((account) => account.friendlyName);
  if (names.length <= 1) return names[0] ?? "This account";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmailInboxPanel({
  token,
  initialAccountId = "",
  initialFolder = "inbox",
  initialUid = null,
}: EmailInboxPanelProps) {
  const [accounts, setAccounts] = useState<EmailAccountItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState<MailboxFolder>(initialFolder);
  const [messages, setMessages] = useState<MailboxMessageSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [detail, setDetail] = useState<MailboxMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [staff, setStaff] = useState<UserListItem[]>([]);
  const [taggingUid, setTaggingUid] = useState<number | null>(null);
  const [savingAssigneeUid, setSavingAssigneeUid] = useState<number | null>(null);
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<MailboxReplyMode | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const [savingAutoReply, setSavingAutoReply] = useState(false);
  const [autoReplyError, setAutoReplyError] = useState<string | null>(null);
  const deepLinkRef = useRef({
    accountId: initialAccountId,
    folder: initialFolder,
    uid: initialUid && initialUid > 0 ? initialUid : null,
    done: !(initialUid && initialUid > 0 && initialAccountId),
  });
  const incomingLink =
    initialAccountId && initialUid && initialUid > 0
      ? `${initialAccountId}:${initialFolder}:${initialUid}`
      : "";
  const [appliedLink, setAppliedLink] = useState(incomingLink);
  if (incomingLink && incomingLink !== appliedLink) {
    setAppliedLink(incomingLink);
    setAccountId(initialAccountId);
    setFolder(initialFolder);
    deepLinkRef.current = {
      accountId: initialAccountId,
      folder: initialFolder,
      uid: initialUid,
      done: false,
    };
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingAccounts(true);
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

  useEffect(() => {
    if (!mailboxReady || !accountId) {
      setMessages([]);
      setListError(null);
      setSelectedUid(null);
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setListError(null);
    setSelectedUid(null);
    setDetail(null);
    setDetailError(null);
    setComposeMode(null);
    setReplyNotice(null);
    setTaggingUid(null);
    getMailboxMessages(token, accountId, folder)
      .then(({ messages: list }) => {
        if (cancelled) return;
        setMessages(list);
        const link = deepLinkRef.current;
        if (
          !link.done &&
          link.uid &&
          accountId === link.accountId &&
          folder === link.folder
        ) {
          if (list.some((message) => message.uid === link.uid)) {
            setSelectedUid(link.uid);
          }
          link.done = true;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setListError(
          err instanceof ApiError
            ? err.message
            : "Could not load this mailbox.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, accountId, folder, mailboxReady, listAttempt]);

  useEffect(() => {
    if (!mailboxReady || !accountId || selectedUid == null) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    setComposeMode(null);
    getMailboxMessage(token, accountId, selectedUid, folder)
      .then(({ message }) => {
        if (!cancelled) setDetail(message);
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(
          err instanceof ApiError ? err.message : "Could not open this message.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, accountId, folder, selectedUid, mailboxReady]);

  async function handleAssignees(uid: number, userIds: string[]) {
    setSavingAssigneeUid(uid);
    setAssigneeError(null);
    try {
      const result = await setMailboxAssignees(token, accountId, uid, {
        folder,
        userIds,
      });
      setMessages((current) =>
        current.map((message) =>
          message.uid === uid
            ? {
                ...message,
                assignees: result.assignees,
                messageKey: result.messageKey,
              }
            : message,
        ),
      );
    } catch (err) {
      setAssigneeError(
        err instanceof ApiError ? err.message : "Could not update staff tags.",
      );
    } finally {
      setSavingAssigneeUid(null);
    }
  }

  async function handleSendReply(input: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    html: string;
  }) {
    if (selectedUid == null || !composeMode) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const result = await replyToMailboxMessage(token, accountId, selectedUid, {
        folder,
        mode: composeMode,
        ...input,
      });
      setComposeMode(null);
      setReplyNotice(
        result.savedToSent
          ? "Email sent."
          : "Email sent, but it could not be saved to the Sent folder.",
      );
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

  const disconnected = accounts.filter((account) => !account.imapHost?.trim());

  return (
    <section className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--staff-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          {(["inbox", "sent"] as const).map((value) => {
            const active = folder === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFolder(value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  active
                    ? "bg-brand-dark text-white"
                    : "text-neutral-600 hover:bg-white"
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
        </div>
        {accounts.length > 0 ? (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
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
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_1fr]">
            <div
              className={`max-h-[640px] overflow-y-auto border-[var(--staff-border)] md:border-r ${
                selectedUid != null ? "hidden md:block" : "block"
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
                    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
                  >
                    Retry
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <p className="p-3 text-xs text-neutral-500">
                  {folder === "inbox" ? "Inbox is empty." : "No sent mail in this folder."}
                </p>
              ) : (
                <ul>
                  {messages.map((message) => {
                    const active = selectedUid === message.uid;
                    const who =
                      folder === "sent"
                        ? formatAddressList(message.to)
                        : formatAddressList(message.from);
                    return (
                      <li
                        key={message.uid}
                        className={`border-b border-[var(--staff-border)] ${
                          active
                            ? "border-l-2 border-l-brand-orange bg-orange-50"
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedUid(message.uid)}
                          className={`w-full px-3 pt-2.5 text-left ${
                            active ? "" : "hover:bg-white"
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className={`truncate text-xs text-brand-dark ${
                                message.seen ? "font-medium" : "font-semibold"
                              }`}
                            >
                              {who}
                            </span>
                            <span className="shrink-0 text-[10px] text-neutral-400">
                              {formatWhen(message.date)}
                            </span>
                          </div>
                          <div
                            className={`truncate text-xs text-neutral-700 ${
                              message.seen ? "" : "font-semibold"
                            }`}
                          >
                            {message.subject}
                          </div>
                          {message.snippet ? (
                            <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                              {message.snippet}
                            </p>
                          ) : null}
                        </button>
                        <EmailStaffTags
                          staff={staff}
                          assigneeIds={message.assignees ?? []}
                          open={taggingUid === message.uid}
                          saving={savingAssigneeUid === message.uid}
                          error={taggingUid === message.uid ? assigneeError : null}
                          onToggleOpen={() =>
                            setTaggingUid((current) =>
                              current === message.uid ? null : message.uid,
                            )
                          }
                          onChange={(userIds) =>
                            void handleAssignees(message.uid, userIds)
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div
              className={`min-h-[280px] max-h-[640px] overflow-y-auto ${
                selectedUid == null ? "hidden md:block" : "block"
              }`}
            >
              {selectedUid == null ? (
                <p className="p-4 text-xs text-neutral-500">
                  Select a message to read it.
                </p>
              ) : loadingDetail ? (
                <div className="flex items-center gap-2 p-4 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Opening…
                </div>
              ) : detailError ? (
                <p className="p-4 text-xs text-red-700">{detailError}</p>
              ) : detail ? (
                <article className="flex h-full flex-col">
                  <header className="border-b border-[var(--staff-border)] px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedUid(null)}
                      className="mb-2 text-[11px] text-neutral-500 md:hidden"
                    >
                      Back to list
                    </button>
                    <h3 className="text-sm font-semibold text-brand-dark">
                      {detail.subject}
                    </h3>
                    <p className="mt-1 text-xs text-neutral-600">
                      From {formatAddressList(detail.from)}
                    </p>
                    <p className="text-xs text-neutral-600">
                      To {formatAddressList(detail.to)}
                    </p>
                    {detail.cc?.length ? (
                      <p className="text-xs text-neutral-600">
                        Cc {formatAddressList(detail.cc)}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-neutral-400">
                      {formatWhen(detail.date)}
                    </p>
                    {detail.attachments.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-500">
                        {detail.attachments.map((file, index) => (
                          <li key={`${file.filename}-${index}`}>
                            {file.filename} · {file.contentType} ·{" "}
                            {formatBytes(file.size)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </header>
                  <div className="min-h-0 flex-1 bg-white">
                    {detail.html ? (
                      <iframe
                        title={detail.subject || "Email"}
                        sandbox=""
                        srcDoc={detail.html}
                        className="h-[360px] w-full border-0 bg-white"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap p-4 font-sans text-sm text-neutral-800">
                        {detail.text || "(No message body)"}
                      </pre>
                    )}
                  </div>
                  {replyNotice ? (
                    <p className="border-t border-[var(--staff-border)] px-4 py-2 text-xs text-neutral-600">
                      {replyNotice}
                    </p>
                  ) : null}
                  <div className="flex gap-2 border-t border-[var(--staff-border)] px-4 py-2">
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
                          onClick={() => {
                            setReplyError(null);
                            setReplyNotice(null);
                            setComposeMode(active ? null : mode);
                          }}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                            active
                              ? "bg-brand-dark text-white"
                              : "border border-[var(--staff-border)] text-neutral-700 hover:bg-white"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {composeMode ? (
                    <EmailReplyComposer
                      key={`${detail.uid}-${composeMode}`}
                      mode={composeMode}
                      folder={folder}
                      detail={detail}
                      ownAddress={selectedAccount?.fromEmail ?? ""}
                      sending={sendingReply}
                      error={replyError}
                      onCancel={() => setComposeMode(null)}
                      onSend={(input) => void handleSendReply(input)}
                    />
                  ) : null}
                </article>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
