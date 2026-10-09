"use client";

import { FormEvent, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
  }) => void;
};

const MODE_LABEL: Record<MailboxReplyMode, string> = {
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

function isBlankHtml(html: string): boolean {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim().length === 0;
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
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(replySubject(detail.subject, mode));
  const [html, setHtml] = useState("<p></p>");
  const [localError, setLocalError] = useState<string | null>(null);

  const intro =
    mode === "forward"
      ? "Forwarded message"
      : detail.date
        ? `On ${new Date(detail.date).toLocaleString()}, ${formatAddressList(detail.from)} wrote:`
        : `${formatAddressList(detail.from)} wrote:`;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
    });
  }

  const message = localError || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-[var(--staff-border)] bg-[var(--staff-surface)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brand-dark">{MODE_LABEL[mode]}</p>
        {showBcc ? null : (
          <button
            type="button"
            onClick={() => setShowBcc(true)}
            className="text-[11px] font-medium text-neutral-500 hover:text-brand-dark"
          >
            Bcc
          </button>
        )}
      </div>
      <AddressField label="To" value={to} onChange={setTo} />
      <AddressField label="Cc" value={cc} onChange={setCc} />
      {showBcc ? <AddressField label="Bcc" value={bcc} onChange={setBcc} /> : null}
      <AddressField label="Subj" value={subject} onChange={setSubject} />
      <EmailBodyEditor
        value={html}
        onChange={setHtml}
        placeholder="Write your reply…"
      />
      <div className="rounded-md border border-[var(--staff-border)] bg-white p-2">
        <p className="text-[11px] text-neutral-500">{intro}</p>
        {mode === "forward" ? (
          <p className="mt-1 text-[11px] text-neutral-500">
            From {formatAddressList(detail.from)}
            <br />
            To {formatAddressList(detail.to)}
          </p>
        ) : null}
        {detail.html ? (
          <iframe
            title="Quoted message"
            sandbox=""
            srcDoc={detail.html}
            className="mt-2 h-28 w-full border-0 bg-white"
          />
        ) : (
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-sans text-xs text-neutral-700">
            {detail.text || "(No message body)"}
          </pre>
        )}
      </div>
      {message ? <p className="text-xs text-red-700">{message}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Send
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddressField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-8 shrink-0 text-neutral-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--staff-border)] bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-brand-orange"
      />
    </label>
  );
}
