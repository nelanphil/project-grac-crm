"use client";

import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import EmailBodyEditor from "@/components/messaging/EmailBodyEditor";
import {
  ApiError,
  getInboxEmailFormat,
  setInboxEmailFormat,
  type InboxTimelineMessage,
  type MailboxAddress,
} from "@/lib/api";
import {
  attachmentKey,
  formatAttachmentSize,
  mergeAttachments,
} from "@/lib/emailAttachments";
import { formatAddressList, parseAddressList } from "@/lib/mailboxReply";
import {
  CANNED_REPLY_TEMPLATES,
  renderFullReplyPreview,
} from "@/lib/replyTemplate";

export type InboxEmailDraft = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  useBrandTemplate: boolean;
  includeQuoted: boolean;
  attachments: File[];
  replyToEmailId: string;
};

export const NEW_EMAIL_TARGET = "new";

type InboxEmailComposerProps = {
  token: string;
  original: InboxTimelineMessage | null;
  replyOptions: InboxTimelineMessage[];
  replyTargetId: string;
  onChangeReplyTarget: (id: string) => void;
  initialTo: string;
  initialSubject: string;
  initialHtml: string;
  fromLabel: string;
  sending: boolean;
  error: string | null;
  onCancel: () => void;
  onSend: (input: InboxEmailDraft) => void;
};

type WindowState = "docked" | "maximized" | "minimized";
type TabView = "compose" | "preview";

function isBlankHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim().length === 0
  );
}

function quoteFromMessage(message: InboxTimelineMessage): {
  html: string;
  text: string;
  from: MailboxAddress[];
  to: MailboxAddress[];
  date: string | null;
  subject: string;
} {
  return {
    html: message.html,
    text: message.body,
    from: [{ name: message.senderName || "", address: message.from }],
    to: message.to ? [{ name: "", address: message.to }] : [],
    date: message.at,
    subject: message.subject,
  };
}

function replyOptionLabel(message: InboxTimelineMessage): string {
  const who =
    message.direction === "outbound"
      ? `You to ${message.to || "recipient"}`
      : message.senderName || message.from || "Unknown sender";
  const when = new Date(message.at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${message.subject || "(no subject)"} · ${who} · ${when}`;
}

export default function InboxEmailComposer({
  token,
  original,
  replyOptions,
  replyTargetId,
  onChangeReplyTarget,
  initialTo,
  initialSubject,
  initialHtml,
  fromLabel,
  sending,
  error,
  onCancel,
  onSend,
}: InboxEmailComposerProps) {
  const quote = useMemo(
    () => (original ? quoteFromMessage(original) : null),
    [original],
  );

  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [html, setHtml] = useState(initialHtml || "<p></p>");
  const [useBrandTemplate, setUseBrandTemplate] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [windowState, setWindowState] = useState<WindowState>("docked");
  const [tabView, setTabView] = useState<TabView>("compose");
  const [showQuoted, setShowQuoted] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [toTouched, setToTouched] = useState(false);
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [seenTargetId, setSeenTargetId] = useState(replyTargetId);
  const [simpleRecipients, setSimpleRecipients] = useState<string[]>([]);
  const [savingFormat, setSavingFormat] = useState(false);

  if (seenTargetId !== replyTargetId) {
    setSeenTargetId(replyTargetId);
    if (!toTouched) setTo(initialTo);
    if (!subjectTouched) setSubject(initialSubject);
  }

  const toAddresses = useMemo(
    () => parseAddressList(to).ok.map((address) => address.toLowerCase()),
    [to],
  );
  const formatLookupKey = useMemo(
    () =>
      [...new Set([...toAddresses, ...parseAddressList(cc).ok.map((a) => a.toLowerCase())])]
        .sort()
        .join(","),
    [toAddresses, cc],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const emails = formatLookupKey ? formatLookupKey.split(",") : [];
      if (emails.length === 0) {
        setSimpleRecipients([]);
        return;
      }
      getInboxEmailFormat(token, emails)
        .then((result) => {
          if (!cancelled) setSimpleRecipients(result.simpleFormat);
        })
        .catch(() => {
          if (!cancelled) setSimpleRecipients([]);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, formatLookupKey]);

  const simpleFormatActive = simpleRecipients.length > 0;
  const allToSimple =
    toAddresses.length > 0 && toAddresses.every((address) => simpleRecipients.includes(address));

  async function toggleSimpleFormat(on: boolean) {
    if (toAddresses.length === 0) {
      setLocalError("Add a recipient first.");
      return;
    }
    setSavingFormat(true);
    try {
      await Promise.all(toAddresses.map((address) => setInboxEmailFormat(token, address, on)));
      setSimpleRecipients((current) =>
        on
          ? [...new Set([...current, ...toAddresses])]
          : current.filter((address) => !toAddresses.includes(address)),
      );
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : "Could not save the email format.");
    } finally {
      setSavingFormat(false);
    }
  }
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!templateMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(event.target as Node)
      ) {
        setTemplateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [templateMenuOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !sending) {
        event.preventDefault();
        submitRef.current();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sending]);

  const intro = !quote
    ? ""
    : quote.date
      ? `On ${new Date(quote.date).toLocaleString()}, ${formatAddressList(quote.from)} wrote:`
      : `${formatAddressList(quote.from)} wrote:`;

  function submitReply() {
    const toParsed = parseAddressList(to);
    const ccParsed = parseAddressList(cc);
    const bccParsed = parseAddressList(bcc);

    if (
      toParsed.invalid.length > 0 ||
      ccParsed.invalid.length > 0 ||
      bccParsed.invalid.length > 0
    ) {
      setLocalError("Enter valid email addresses, separated by commas.");
      setTabView("compose");
      return;
    }
    if (toParsed.ok.length === 0) {
      setLocalError("Add at least one recipient.");
      setTabView("compose");
      return;
    }
    if (!subject.trim()) {
      setLocalError("Add a subject.");
      setTabView("compose");
      return;
    }
    if (isBlankHtml(html)) {
      setLocalError("Write a message before sending.");
      setTabView("compose");
      return;
    }
    setLocalError(null);
    onSend({
      to: toParsed.ok,
      cc: ccParsed.ok,
      bcc: bccParsed.ok,
      subject: subject.trim(),
      html,
      useBrandTemplate,
      includeQuoted: Boolean(quote),
      attachments,
      replyToEmailId: original ? original.id : NEW_EMAIL_TARGET,
    });
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const result = mergeAttachments(attachments, Array.from(list));
    setAttachments(result.files);
    setLocalError(result.error);
  }

  function removeAttachment(key: string) {
    setAttachments((current) => current.filter((file) => attachmentKey(file) !== key));
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  }

  useEffect(() => {
    submitRef.current = submitReply;
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitReply();
  }

  function handleSelectTemplate(snippet: string) {
    if (isBlankHtml(html)) {
      setHtml(snippet);
    } else {
      setHtml(`${html}<br/>${snippet}`);
    }
    setTemplateMenuOpen(false);
  }

  const message = localError || error;
  const modeLabel = original ? "Reply" : "New email";
  const brandApplied = useBrandTemplate && !simpleFormatActive;
  const fieldClass =
    "w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2.5 py-1 text-xs text-[var(--staff-ink)] outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/30";

  if (windowState === "minimized") {
    return createPortal(
      <div
        className="fixed bottom-0 right-4 z-[80] flex max-w-sm items-center justify-between gap-3 rounded-t-xl border border-b-0 border-[var(--staff-border)] bg-brand-midnight px-4 py-2.5 text-white shadow-2xl transition-all hover:brightness-110 sm:right-6"
        onClick={() => setWindowState("docked")}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setWindowState("docked");
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded bg-brand-orange px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
            {modeLabel}
          </span>
          <p className="truncate text-xs font-medium text-neutral-200">
            {subject || "New message"}
          </p>
          {attachments.length > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-neutral-300">
              <Paperclip className="h-3 w-3" />
              {attachments.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            title="Expand composer"
            onClick={() => setWindowState("docked")}
            className="rounded p-1 text-neutral-300 hover:bg-white/10 hover:text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Close composer"
            onClick={onCancel}
            className="rounded p-1 text-neutral-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  const isMaximized = windowState === "maximized";
  const containerClasses = isMaximized
    ? "fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs sm:p-6"
    : "fixed right-3 bottom-0 z-[80] flex h-[min(670px,calc(100vh-4rem))] w-[min(720px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-t-2xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-2xl sm:right-6";
  const dialogClasses = isMaximized
    ? "flex h-[min(820px,calc(100vh-3rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-2xl"
    : "flex h-full w-full flex-col overflow-hidden";

  return createPortal(
    <div className={containerClasses}>
      <div className={dialogClasses}>
        <header className="flex shrink-0 items-center justify-between bg-brand-midnight px-4 py-2.5 text-white select-none">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded bg-brand-orange px-2 py-0.5 text-[11px] font-bold tracking-wider text-white uppercase">
              {modeLabel}
            </span>
            <span className="truncate text-xs font-semibold text-white/90">
              {subject || modeLabel}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div className="mr-2 flex items-center rounded-lg bg-white/10 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setTabView("compose")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
                  tabView === "compose"
                    ? "bg-brand-orange text-white shadow-xs"
                    : "text-neutral-300 hover:text-white"
                }`}
              >
                <Edit3 className="h-3 w-3" />
                Compose
              </button>
              <button
                type="button"
                onClick={() => setTabView("preview")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
                  tabView === "preview"
                    ? "bg-brand-orange text-white shadow-xs"
                    : "text-neutral-300 hover:text-white"
                }`}
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
            </div>
            <button
              type="button"
              title="Minimize"
              onClick={() => setWindowState("minimized")}
              className="rounded p-1 text-neutral-300 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={isMaximized ? "Restore window" : "Maximize window"}
              onClick={() => setWindowState(isMaximized ? "docked" : "maximized")}
              className="rounded p-1 text-neutral-300 transition-colors hover:bg-white/15 hover:text-white"
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              title="Close and discard"
              onClick={onCancel}
              className="rounded p-1 text-neutral-300 transition-colors hover:bg-red-600 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {tabView === "preview" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--staff-canvas)] p-2 sm:p-4">
            <div className="mb-2 flex shrink-0 items-center justify-between px-1 text-xs text-[var(--staff-muted)]">
              <span className="font-medium text-[var(--staff-ink)]">Live email recipient view</span>
              <span className="text-[11px]">
                {simpleFormatActive
                  ? "Simple format (recipient can't see the branded layout)"
                  : useBrandTemplate
                    ? "GMF branded letterhead and signature applied"
                    : "Plain reply (no letterhead)"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-inner">
              <iframe
                title="Reply live preview"
                sandbox=""
                srcDoc={renderFullReplyPreview({
                  bodyHtml: html,
                  mode: "reply",
                  useBrandTemplate,
                  simpleFormat: simpleFormatActive,
                  includeQuoted: Boolean(quote),
                  original: quote ?? {
                    html: "",
                    text: "",
                    from: [],
                    to: [],
                    date: null,
                    subject: "",
                  },
                })}
                className="h-full w-full border-0 bg-[var(--staff-canvas)]"
              />
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex min-h-0 flex-1 flex-col space-y-2.5 overflow-y-auto bg-[var(--staff-surface)] px-4 py-3 ${
              dragActive ? "outline-2 -outline-offset-4 outline-dashed outline-brand-orange" : ""
            }`}
          >
            <div className="space-y-1.5 border-b border-[var(--staff-border)] pb-2.5">
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs font-medium text-[var(--staff-muted)]">
                  Reply
                </span>
                <select
                  value={original ? original.id : NEW_EMAIL_TARGET}
                  onChange={(event) => onChangeReplyTarget(event.target.value)}
                  disabled={sending}
                  title="Choose which email this reply quotes and threads onto"
                  className={fieldClass}
                >
                  {replyOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {replyOptionLabel(option)}
                    </option>
                  ))}
                  <option value={NEW_EMAIL_TARGET}>New email (no thread)</option>
                </select>
              </label>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs font-medium text-[var(--staff-muted)]">
                  To
                </span>
                <input
                  type="text"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setToTouched(true);
                  }}
                  placeholder="recipient@example.com"
                  className={fieldClass}
                />
                <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[var(--staff-muted)]">
                  {!showCc ? (
                    <button
                      type="button"
                      onClick={() => setShowCc(true)}
                      className="hover:text-[var(--staff-ink)] hover:underline"
                    >
                      Cc
                    </button>
                  ) : null}
                  {!showBcc ? (
                    <button
                      type="button"
                      onClick={() => setShowBcc(true)}
                      className="hover:text-[var(--staff-ink)] hover:underline"
                    >
                      Bcc
                    </button>
                  ) : null}
                </div>
              </div>
              {showCc ? (
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-medium text-[var(--staff-muted)]">
                    Cc
                  </span>
                  <input
                    type="text"
                    value={cc}
                    onChange={(event) => setCc(event.target.value)}
                    placeholder="cc@example.com"
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCc("");
                      setShowCc(false);
                    }}
                    title="Remove Cc"
                    className="text-[var(--staff-muted)] hover:text-[var(--staff-ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
              {showBcc ? (
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-medium text-[var(--staff-muted)]">
                    Bcc
                  </span>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(event) => setBcc(event.target.value)}
                    placeholder="bcc@example.com"
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBcc("");
                      setShowBcc(false);
                    }}
                    title="Remove Bcc"
                    className="text-[var(--staff-muted)] hover:text-[var(--staff-ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs font-medium text-[var(--staff-muted)]">
                  Subj
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setSubjectTouched(true);
                  }}
                  placeholder="Subject"
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="relative" ref={templateMenuRef}>
                  <button
                    type="button"
                    onClick={() => setTemplateMenuOpen((open) => !open)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--staff-border)] bg-[var(--staff-cream)] px-2.5 py-1 text-xs font-medium text-[var(--staff-ink)] transition-colors hover:bg-[var(--staff-canvas)]"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-brand-orange" />
                    Insert quick template
                    <ChevronDown className="h-3 w-3 text-[var(--staff-muted)]" />
                  </button>
                  {templateMenuOpen ? (
                    <div className="absolute top-full left-0 z-30 mt-1 w-72 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] p-1.5 shadow-lg">
                      <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-[var(--staff-muted)] uppercase">
                        Canned company responses
                      </p>
                      <div className="space-y-0.5">
                        {CANNED_REPLY_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => handleSelectTemplate(template.body)}
                            className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--staff-ink)] transition-colors hover:bg-[var(--staff-cream)]"
                          >
                            <div className="font-medium">{template.title}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--staff-border)] bg-[var(--staff-cream)] px-2.5 py-1 text-xs font-medium text-[var(--staff-ink)] transition-colors hover:bg-[var(--staff-canvas)]"
                >
                  <Paperclip className="h-3.5 w-3.5 text-brand-orange" />
                  Attach files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
              {fromLabel ? (
                <div className="text-[11px] text-[var(--staff-muted)]">
                  From: <span className="font-medium text-[var(--staff-ink)]">{fromLabel}</span>
                </div>
              ) : null}
            </div>

            {simpleFormatActive ? (
              <p className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                {simpleRecipients.join(", ")} {simpleRecipients.length === 1 ? "gets" : "get"} the
                simple format, so the branded layout is skipped for this email.
              </p>
            ) : null}

            <div className="min-h-[160px] flex-1">
              <EmailBodyEditor
                value={html}
                onChange={setHtml}
                placeholder="Write your reply message here…"
              />
            </div>

            {attachments.length > 0 ? (
              <ul className="flex shrink-0 flex-wrap gap-1.5">
                {attachments.map((file) => {
                  const key = attachmentKey(file);
                  return (
                    <li
                      key={key}
                      className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-[var(--staff-border)] bg-[var(--staff-cream)] px-2 py-1 text-[11px] text-[var(--staff-ink)]"
                    >
                      <Paperclip className="h-3 w-3 shrink-0 text-[var(--staff-muted)]" />
                      <span className="truncate font-medium" title={file.name}>
                        {file.name}
                      </span>
                      <span className="shrink-0 text-[var(--staff-muted)]">
                        {formatAttachmentSize(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(key)}
                        disabled={sending}
                        title={`Remove ${file.name}`}
                        className="shrink-0 text-[var(--staff-muted)] hover:text-[var(--staff-ink)] disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {quote ? (
              <div className="shrink-0 overflow-hidden rounded-lg border border-[var(--staff-border)] bg-[var(--staff-cream)]">
                <button
                  type="button"
                  onClick={() => setShowQuoted((open) => !open)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-[var(--staff-muted)] transition-colors hover:bg-[var(--staff-canvas)]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {showQuoted ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{intro}</span>
                  </div>
                  <span className="ml-2 shrink-0 text-[11px]">
                    {showQuoted ? "Hide quoted message" : "Show quoted message"}
                  </span>
                </button>
                {showQuoted ? (
                  <div className="border-t border-[var(--staff-border)] bg-[var(--staff-surface)] p-3">
                    {quote.html ? (
                      <iframe
                        title="Quoted message body"
                        sandbox=""
                        srcDoc={quote.html}
                        className="h-44 w-full border-0 bg-[var(--staff-surface)]"
                      />
                    ) : (
                      <pre className="max-h-44 overflow-auto font-sans text-xs whitespace-pre-wrap text-[var(--staff-ink)]">
                        {quote.text || "(No message body)"}
                      </pre>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

          </form>
        )}

        {message ? (
          <p className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
            {message}
          </p>
        ) : null}

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--staff-border)] bg-[var(--staff-cream)] px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label
              className={`flex items-center gap-2 text-xs font-medium text-[var(--staff-ink)] select-none ${
                simpleFormatActive ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              }`}
              title={
                simpleFormatActive
                  ? "A recipient is set to the simple format, so the branded layout is skipped"
                  : "Wraps the reply in Generator Maintenance of Florida letterhead, contact numbers, and Generac credentials"
              }
            >
              <input
                type="checkbox"
                checked={brandApplied}
                disabled={simpleFormatActive}
                onChange={(event) => setUseBrandTemplate(event.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-[var(--staff-border)] accent-brand-orange disabled:cursor-not-allowed"
              />
              <span className="inline-flex items-center gap-1.5">
                Apply GMF branded template
                <span className="rounded bg-brand-midnight px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  On brand
                </span>
              </span>
            </label>
            <label
              className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--staff-muted)] select-none"
              title="Remembered for each To address. Use it when someone tells you our emails arrive blank."
            >
              <input
                type="checkbox"
                checked={allToSimple}
                disabled={savingFormat || toAddresses.length === 0}
                onChange={(event) => void toggleSimpleFormat(event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded border-[var(--staff-border)] accent-brand-orange disabled:cursor-not-allowed"
              />
              Recipient sees blank emails: always send simple format
              {savingFormat ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={sending}
              className="rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-1.5 text-xs font-medium text-[var(--staff-ink)] transition-colors hover:bg-[var(--staff-canvas)] disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={submitReply}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f6fed] px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#245ed0] disabled:opacity-60"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {original ? "Send reply" : "Send"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
