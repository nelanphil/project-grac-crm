"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  ApiError,
  EmailAccountItem,
  MailboxFolder,
  MailboxMessageDetail,
  MailboxMessageSummary,
  getEmailAccounts,
  getMailboxMessage,
  getMailboxMessages,
} from "@/lib/api";

type EmailInboxPanelProps = {
  token: string;
};

function formatAddress(
  list: { name: string; address: string }[],
): string {
  if (list.length === 0) return "Unknown";
  return list
    .map((item) =>
      item.name ? `${item.name} <${item.address}>` : item.address,
    )
    .join(", ");
}

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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmailInboxPanel({ token }: EmailInboxPanelProps) {
  const [accounts, setAccounts] = useState<EmailAccountItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState<MailboxFolder>("inbox");
  const [messages, setMessages] = useState<MailboxMessageSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [detail, setDetail] = useState<MailboxMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAccounts(true);
    getEmailAccounts(token)
      .then(({ accounts: list }) => {
        if (cancelled) return;
        const active = list.filter((account) => account.isActive);
        setAccounts(active);
        const firstConnected = active.find((account) => account.imapHost?.trim());
        setAccountId(firstConnected?._id ?? active[0]?._id ?? "");
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
    getMailboxMessages(token, accountId, folder)
      .then(({ messages: list }) => {
        if (!cancelled) setMessages(list);
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
  }, [token, accountId, folder, mailboxReady]);

  useEffect(() => {
    if (!mailboxReady || !accountId || selectedUid == null) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
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
              {disconnected.length} account
              {disconnected.length === 1 ? "" : "s"} not connected. Add an IMAP
              host in{" "}
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
              className={`max-h-[520px] overflow-y-auto border-[var(--staff-border)] md:border-r ${
                selectedUid != null ? "hidden md:block" : "block"
              }`}
            >
              {loadingMessages ? (
                <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : listError ? (
                <p className="p-3 text-xs text-red-700">{listError}</p>
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
                        ? formatAddress(message.to)
                        : formatAddress(message.from);
                    return (
                      <li key={message.uid}>
                        <button
                          type="button"
                          onClick={() => setSelectedUid(message.uid)}
                          className={`w-full border-b border-[var(--staff-border)] px-3 py-2.5 text-left ${
                            active
                              ? "border-l-2 border-l-brand-orange bg-orange-50"
                              : "hover:bg-white"
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
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div
              className={`min-h-[280px] ${
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
                      From {formatAddress(detail.from)}
                    </p>
                    <p className="text-xs text-neutral-600">
                      To {formatAddress(detail.to)}
                    </p>
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
                        className="h-[480px] w-full border-0 bg-white"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap p-4 font-sans text-sm text-neutral-800">
                        {detail.text || "(No message body)"}
                      </pre>
                    )}
                  </div>
                </article>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
