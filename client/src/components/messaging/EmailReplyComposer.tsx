"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import EmailBodyEditor from "@/components/messaging/EmailBodyEditor";
import type {
  MailboxFolder,
  MailboxMessageDetail,
  MailboxReplyMode,
} from "@/lib/api";
import {
  defaultRecipients,
  formatAddressList,
  joinAddresses,
  parseAddressList,
  replySubject,
} from "@/lib/mailboxReply";
import {
  CANNED_REPLY_TEMPLATES,
  renderFullReplyPreview,
} from "@/lib/replyTemplate";

type EmailReplyComposerProps = {
  mode: MailboxReplyMode;
  folder: MailboxFolder;
  detail: MailboxMessageDetail;
  ownAddress: string;
  sending: boolean;
  error: string | null;
  onCancel: () => void;
  onSend: (input: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    html: string;
    useBrandTemplate: boolean;
  }) => void;
};

const MODE_LABEL: Record<MailboxReplyMode, string> = {
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
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

export default function EmailReplyComposer({
  mode,
  folder,
  detail,
  ownAddress,
  sending,
  error,
  onCancel,
  onSend,
}: EmailReplyComposerProps) {
  const defaults = useMemo(
    () =>
      defaultRecipients({
        mode,
        folder,
        from: detail.from,
        to: detail.to,
        cc: detail.cc ?? [],
        ownAddress,
      }),
    [mode, folder, detail, ownAddress],
  );

  const [to, setTo] = useState(joinAddresses(defaults.to));
  const [cc, setCc] = useState(joinAddresses(defaults.cc));
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(defaults.cc.length > 0);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(replySubject(detail.subject, mode));
  const [html, setHtml] = useState("<p></p>");
  const [useBrandTemplate, setUseBrandTemplate] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [windowState, setWindowState] = useState<WindowState>("docked");
  const [tabView, setTabView] = useState<TabView>("compose");
  const [showQuoted, setShowQuoted] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Close template menu on click outside
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

  // Keyboard shortcut: Cmd+Enter / Ctrl+Enter to send
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !sending
      ) {
        event.preventDefault();
        submitReply();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const intro =
    mode === "forward"
      ? "Forwarded message"
      : detail.date
        ? `On ${new Date(detail.date).toLocaleString()}, ${formatAddressList(detail.from)} wrote:`
        : `${formatAddressList(detail.from)} wrote:`;

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
      return;
    }
    if (toParsed.ok.length === 0) {
      setLocalError("Add at least one recipient.");
      return;
    }
    if (!subject.trim()) {
      setLocalError("Add a subject.");
      return;
    }
    if (isBlankHtml(html)) {
      setLocalError("Write a message before sending.");
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
    });
  }

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

  // Minimized Floating Pill
  if (windowState === "minimized") {
    return (
      <div
        className="fixed bottom-0 right-4 sm:right-6 z-50 flex items-center justify-between gap-3 rounded-t-xl bg-brand-midnight text-white px-4 py-2.5 shadow-2xl hover:bg-neutral-900 transition-all border border-b-0 border-neutral-700 max-w-sm"
        onClick={() => setWindowState("docked")}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded bg-brand-orange px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
            {MODE_LABEL[mode]}
          </span>
          <p className="truncate text-xs font-medium text-neutral-200">
            {subject || "New Message"}
          </p>
        </div>
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title="Expand composer"
            onClick={() => setWindowState("docked")}
            className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Close composer"
            onClick={onCancel}
            className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const isMaximized = windowState === "maximized";

  // Composer Window Frame
  const containerClasses = isMaximized
    ? "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6"
    : "fixed bottom-0 right-3 sm:right-6 z-50 w-[min(720px,calc(100vw-1.5rem))] h-[min(670px,calc(100vh-4rem))] flex flex-col rounded-t-2xl bg-white shadow-2xl border border-neutral-300 overflow-hidden animate-in slide-in-from-bottom-4 duration-200";

  const dialogClasses = isMaximized
    ? "w-full max-w-4xl h-[min(820px,calc(100vh-3rem))] flex flex-col rounded-2xl bg-white shadow-2xl border border-neutral-200 overflow-hidden"
    : "flex flex-col h-full w-full overflow-hidden";

  return (
    <div className={containerClasses}>
      <div className={dialogClasses}>
        {/* Header Bar */}
        <header className="flex items-center justify-between px-4 py-2.5 bg-brand-midnight text-white select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="rounded bg-brand-orange px-2 py-0.5 text-[11px] font-bold text-white uppercase tracking-wider">
              {MODE_LABEL[mode]}
            </span>
            <span className="truncate text-xs font-semibold text-white/90">
              {subject || "Reply"}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Tab switch */}
            <div className="flex items-center mr-2 rounded-lg bg-white/10 p-0.5 text-[11px]">
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

            {/* Window controls */}
            <button
              type="button"
              title="Minimize"
              onClick={() => setWindowState("minimized")}
              className="rounded p-1 text-neutral-300 hover:bg-white/15 hover:text-white transition-colors"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={isMaximized ? "Restore window" : "Maximize window"}
              onClick={() =>
                setWindowState(isMaximized ? "docked" : "maximized")
              }
              className="rounded p-1 text-neutral-300 hover:bg-white/15 hover:text-white transition-colors"
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
              className="rounded p-1 text-neutral-300 hover:bg-red-600 hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        {tabView === "preview" ? (
          <div className="flex-1 min-h-0 bg-neutral-100 p-2 sm:p-4 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1 text-xs text-neutral-600 shrink-0">
              <span className="font-medium text-neutral-700">
                Live Email Recipient View
              </span>
              <span className="text-[11px] text-neutral-500">
                {useBrandTemplate
                  ? "GMF Branded Letterhead & Signature Applied"
                  : "Plain Text Reply (No Letterhead)"}
              </span>
            </div>
            <div className="flex-1 min-h-0 rounded-xl border border-neutral-300 bg-white shadow-inner overflow-hidden">
              <iframe
                title="Reply live preview"
                sandbox=""
                srcDoc={renderFullReplyPreview({
                  bodyHtml: html,
                  mode,
                  useBrandTemplate,
                  original: detail,
                })}
                className="h-full w-full border-0 bg-neutral-50"
              />
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex-1 min-h-0 flex flex-col overflow-y-auto px-4 py-3 space-y-2.5 bg-[var(--staff-surface,#ffffff)]"
          >
            {/* Header Address Fields */}
            <div className="space-y-1.5 border-b border-neutral-200 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs font-medium text-neutral-500">
                  To
                </span>
                <input
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/30"
                />
                <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-medium text-neutral-500">
                  {!showCc && (
                    <button
                      type="button"
                      onClick={() => setShowCc(true)}
                      className="hover:text-brand-dark hover:underline"
                    >
                      Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button
                      type="button"
                      onClick={() => setShowBcc(true)}
                      className="hover:text-brand-dark hover:underline"
                    >
                      Bcc
                    </button>
                  )}
                </div>
              </div>

              {showCc && (
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-medium text-neutral-500">
                    Cc
                  </span>
                  <input
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="cc@example.com"
                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/30"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCc("");
                      setShowCc(false);
                    }}
                    title="Remove Cc"
                    className="text-neutral-400 hover:text-neutral-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {showBcc && (
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-medium text-neutral-500">
                    Bcc
                  </span>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="bcc@example.com"
                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/30"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBcc("");
                      setShowBcc(false);
                    }}
                    title="Remove Bcc"
                    className="text-neutral-400 hover:text-neutral-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs font-medium text-neutral-500">
                  Subj
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/30"
                />
              </div>
            </div>

            {/* Quick Template Selector */}
            <div className="flex items-center justify-between">
              <div className="relative" ref={templateMenuRef}>
                <button
                  type="button"
                  onClick={() => setTemplateMenuOpen((open) => !open)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5 text-brand-orange" />
                  Insert Quick Template
                  <ChevronDown className="h-3 w-3 text-neutral-500" />
                </button>

                {templateMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 z-30 w-72 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      Canned Company Responses
                    </p>
                    <div className="space-y-0.5">
                      {CANNED_REPLY_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => handleSelectTemplate(tpl.body)}
                          className="w-full text-left rounded-md px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
                        >
                          <div className="font-medium">{tpl.title}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-neutral-500">
                From: <span className="font-medium text-neutral-700">{ownAddress}</span>
              </div>
            </div>

            {/* Rich Email Body Editor */}
            <div className="flex-1 min-h-[160px]">
              <EmailBodyEditor
                value={html}
                onChange={setHtml}
                placeholder="Write your reply message here…"
              />
            </div>

            {/* Collapsible Quoted Email Section */}
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setShowQuoted((open) => !open)}
                className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                <div className="flex items-center gap-2 truncate">
                  {showQuoted ? (
                    <ChevronUp className="h-3.5 w-3.5 text-neutral-500" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
                  )}
                  <span className="truncate">{intro}</span>
                </div>
                <span className="text-[11px] text-neutral-400 ml-2 shrink-0">
                  {showQuoted ? "Hide quoted message" : "Show quoted message"}
                </span>
              </button>

              {showQuoted && (
                <div className="border-t border-neutral-200 bg-white p-3">
                  {mode === "forward" && (
                    <div className="mb-2 border-b border-neutral-100 pb-2 text-[11px] text-neutral-500">
                      <div>
                        <strong>From:</strong> {formatAddressList(detail.from)}
                      </div>
                      <div>
                        <strong>To:</strong> {formatAddressList(detail.to)}
                      </div>
                      <div>
                        <strong>Subject:</strong> {detail.subject || "(no subject)"}
                      </div>
                    </div>
                  )}

                  {detail.html ? (
                    <iframe
                      title="Quoted message body"
                      sandbox=""
                      srcDoc={detail.html}
                      className="h-44 w-full border-0 bg-white"
                    />
                  ) : (
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-sans text-xs text-neutral-700">
                      {detail.text || "(No message body)"}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Error Message */}
            {message && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 border border-red-200">
                {message}
              </p>
            )}
          </form>
        )}

        {/* Footer Actions */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-2 text-xs font-medium text-neutral-700 cursor-pointer select-none"
              title="Wraps reply in Generator Maintenance of Florida letterhead, contact numbers, and Generac credentials"
            >
              <input
                type="checkbox"
                checked={useBrandTemplate}
                onChange={(e) => setUseBrandTemplate(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 accent-brand-orange cursor-pointer"
              />
              <span className="inline-flex items-center gap-1.5">
                Apply GMF branded template
                <span className="rounded bg-brand-midnight text-white text-[10px] px-1.5 py-0.2 font-semibold">
                  On Brand
                </span>
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={sending}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 transition-colors"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={submitReply}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-brand-midnight disabled:opacity-60 transition-colors"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 text-brand-orange" />
              )}
              Send Reply
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
