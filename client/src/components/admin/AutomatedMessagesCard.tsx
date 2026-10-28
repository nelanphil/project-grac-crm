"use client";

import { FormEvent, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import {
  ApiError,
  getAutomatedMessageSettings,
  getMessageTemplates,
  saveAutomatedMessageSettings,
  type AutomatedMessageChannel,
  type AutomatedMessageSettings,
  type MessageTemplateItem,
} from "@/lib/api";

const EMAIL_SUBJECT_MAX = 200;
const EMAIL_BODY_MAX = 25_000;
const SMS_BODY_MAX = 1600;

type ChannelKey = Exclude<keyof AutomatedMessageSettings, "saved">;
type TemplateKind = "email" | "sms";
type EditorKind = "email" | "sms" | "receipt-email" | "mailbox";

type TokenDef = { key: string; label: string };

const FIRST_NAME: TokenDef = { key: "first_name", label: "First name" };
const INVOICE_NUMBER: TokenDef = {
  key: "invoice_number",
  label: "Invoice number",
};
const INVOICE_TOTAL: TokenDef = { key: "invoice_total", label: "Invoice total" };
const DUE_DATE: TokenDef = { key: "due_date", label: "Due date" };
const VIEW_URL: TokenDef = { key: "invoice_view_url", label: "Invoice link" };
const PAYMENT_LINK: TokenDef = { key: "payment_link", label: "Payment link" };
const INVOICE: TokenDef = { key: "invoice", label: "Invoice" };

const INVOICE_SUBJECT_TOKENS = [INVOICE_NUMBER, INVOICE_TOTAL, DUE_DATE];
const INVOICE_TEXT_TOKENS = [
  FIRST_NAME,
  INVOICE_NUMBER,
  INVOICE_TOTAL,
  DUE_DATE,
  VIEW_URL,
  PAYMENT_LINK,
];

const CHANNELS: Record<
  ChannelKey,
  {
    label: string;
    kind: EditorKind;
    templateKind: TemplateKind;
    subjectTokens: TokenDef[];
    bodyTokens: TokenDef[];
    hint?: string;
  }
> = {
  workOrderCompleteEmail: {
    label: "Email",
    kind: "email",
    templateKind: "email",
    subjectTokens: INVOICE_SUBJECT_TOKENS,
    bodyTokens: [...INVOICE_TEXT_TOKENS, INVOICE],
    hint: "Include {{invoice}} where the invoice should appear. The payment button is added when the message can be paid.",
  },
  workOrderCompleteSms: {
    label: "Text",
    kind: "sms",
    templateKind: "sms",
    subjectTokens: [],
    bodyTokens: INVOICE_TEXT_TOKENS,
    hint: "If the text does not include {{payment_link}}, the payment link is added at the end.",
  },
  paymentReceivedEmail: {
    label: "Email",
    kind: "receipt-email",
    templateKind: "email",
    subjectTokens: INVOICE_SUBJECT_TOKENS,
    bodyTokens: [...INVOICE_TEXT_TOKENS, INVOICE],
    hint: "Custom wording changes the subject only. The invoice layout from Billing stays the email body. Choose a template to write the full email, and include {{invoice}} in that template to show the invoice.",
  },
  paidInvoiceReceiptEmail: {
    label: "Email",
    kind: "receipt-email",
    templateKind: "email",
    subjectTokens: INVOICE_SUBJECT_TOKENS,
    bodyTokens: [...INVOICE_TEXT_TOKENS, INVOICE],
    hint: "Custom wording changes the subject only. The invoice layout from Billing stays the email body. Choose a template to write the full email, and include {{invoice}} in that template to show the invoice.",
  },
  paidInvoiceReceiptSms: {
    label: "Text",
    kind: "sms",
    templateKind: "sms",
    subjectTokens: [],
    bodyTokens: [FIRST_NAME, INVOICE_NUMBER, INVOICE_TOTAL, VIEW_URL],
    hint: "A blank first name removes a leading \"Hi,\" so this text still reads cleanly when no contact is on file.",
  },
  mailboxReply: {
    label: "Reply",
    kind: "mailbox",
    templateKind: "email",
    subjectTokens: [],
    bodyTokens: [FIRST_NAME],
    hint: "The subject stays Re: plus the original subject. This wording is placed inside the usual reply layout.",
  },
};

const SECTIONS: {
  title: string;
  description: string;
  keys: ChannelKey[];
}[] = [
  {
    title: "Work order completed",
    description:
      "Sent when a work order is marked complete and the invoice is emailed or texted, and when that invoice is resent.",
    keys: ["workOrderCompleteEmail", "workOrderCompleteSms"],
  },
  {
    title: "Payment received",
    description: "Emailed after a card or checkout payment is recorded.",
    keys: ["paymentReceivedEmail"],
  },
  {
    title: "Paid invoice receipt",
    description:
      "Sent when a work order is completed as paid by check or cash, and when staff send that receipt again.",
    keys: ["paidInvoiceReceiptEmail", "paidInvoiceReceiptSms"],
  },
  {
    title: "Mailbox reply",
    description:
      "Sent when an email account is set to acknowledge new mail. The on/off switch stays on that email account.",
    keys: ["mailboxReply"],
  },
];

function editableSnapshot(settings: AutomatedMessageSettings): string {
  const channels = Object.fromEntries(
    (Object.keys(CHANNELS) as ChannelKey[]).map((key) => {
      const channel = settings[key];
      return [
        key,
        {
          mode: channel.mode,
          templateId: channel.templateId,
          subject: channel.subject,
          body: channel.body,
        },
      ];
    }),
  );
  return JSON.stringify(channels);
}

function insertToken(
  value: string,
  token: string,
  el: HTMLInputElement | HTMLTextAreaElement | null,
): string {
  const snippet = `{{${token}}}`;
  if (!el) return `${value}${snippet}`;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
  const pos = start + snippet.length;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  return next;
}

function channelError(
  key: ChannelKey,
  channel: AutomatedMessageChannel,
  templates: MessageTemplateItem[],
  templatesLoaded: boolean,
): string | null {
  const spec = CHANNELS[key];
  if (channel.mode === "template") {
    if (!channel.templateId) return "Choose a template.";
    if (!templatesLoaded) return null;
    const template = templates.find((item) => item._id === channel.templateId);
    if (!template || template.templateType !== spec.templateKind) {
      return "That template is no longer available.";
    }
    if (
      (spec.kind === "email" || spec.kind === "receipt-email") &&
      !template.subject.trim()
    ) {
      return "That template needs a subject.";
    }
    if (!template.body.trim()) return "That template needs a message.";
    return null;
  }

  const needsSubject = spec.kind === "email" || spec.kind === "receipt-email";
  const needsBody = spec.kind !== "receipt-email";
  const bodyMax = spec.kind === "sms" ? SMS_BODY_MAX : EMAIL_BODY_MAX;
  if (needsSubject && !channel.subject.trim()) return "Subject is required.";
  if (channel.subject.trim().length > EMAIL_SUBJECT_MAX) {
    return "Subject must be 200 characters or fewer.";
  }
  if (needsBody && !channel.body.trim()) return "Message is required.";
  if (channel.body.trim().length > bodyMax) {
    return `Message must be ${bodyMax.toLocaleString()} characters or fewer.`;
  }
  return null;
}

function TokenButtons({
  tokens,
  onInsert,
}: {
  tokens: TokenDef[];
  onInsert: (key: string) => void;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tokens.map((token) => (
        <button
          key={token.key}
          type="button"
          title={token.label}
          onClick={() => onInsert(token.key)}
          className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-brand-orange hover:text-brand-orange"
        >
          {`{{${token.key}}}`}
        </button>
      ))}
    </div>
  );
}

function ChannelEditor({
  channelKey,
  channel,
  templates,
  onChange,
}: {
  channelKey: ChannelKey;
  channel: AutomatedMessageChannel;
  templates: MessageTemplateItem[];
  onChange: (next: AutomatedMessageChannel) => void;
}) {
  const spec = CHANNELS[channelKey];
  const [subjectEl, setSubjectEl] = useState<HTMLInputElement | null>(null);
  const [bodyEl, setBodyEl] = useState<HTMLTextAreaElement | null>(null);
  const choices = templates.filter(
    (template) => template.templateType === spec.templateKind && !template.deletedAt,
  );
  const selected =
    choices.find((template) => template._id === channel.templateId) ?? null;
  const showSubject = spec.kind === "email" || spec.kind === "receipt-email";
  const showBody = spec.kind !== "receipt-email";
  const bodyMax = spec.kind === "sms" ? SMS_BODY_MAX : EMAIL_BODY_MAX;

  function patch(partial: Partial<AutomatedMessageChannel>) {
    onChange({ ...channel, ...partial });
  }

  return (
    <div className="rounded-lg border border-neutral-200 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-brand-dark">{spec.label}</h3>
        <div className="inline-flex rounded-md border border-neutral-200 p-0.5">
          {(["template", "custom"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => patch({ mode })}
              className={`rounded px-3 py-1 text-xs font-medium ${
                channel.mode === mode
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:text-brand-dark"
              }`}
            >
              {mode === "template" ? "Template" : "Custom"}
            </button>
          ))}
        </div>
      </div>

      {channel.mode === "template" ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              {spec.templateKind === "email" ? "Email template" : "Text template"}
            </span>
            <select
              value={channel.templateId ?? ""}
              onChange={(event) =>
                patch({ templateId: event.target.value || null })
              }
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
            >
              <option value="">Choose a template</option>
              {channel.templateId &&
                !choices.some((template) => template._id === channel.templateId) && (
                  <option value={channel.templateId}>Missing template</option>
                )}
              {choices.map((template) => (
                <option key={template._id} value={template._id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {channel.templateMissing && (
            <p className="text-sm text-red-600">
              That template is no longer available. Sends use the custom wording
              until you pick another template.
            </p>
          )}
          {selected && (
            <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              {showSubject && (
                <p className="font-medium text-brand-dark">
                  {selected.subject || "No subject"}
                </p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-neutral-600">
                {selected.body || "No message"}
              </p>
            </div>
          )}
          {spec.kind === "mailbox" && (
            <p className="text-xs text-neutral-500">
              The reply subject stays Re: plus the customer&apos;s subject. Only
              the template body is used.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {showSubject && (
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Subject</span>
              <input
                ref={setSubjectEl}
                value={channel.subject}
                maxLength={EMAIL_SUBJECT_MAX}
                onChange={(event) => patch({ subject: event.target.value })}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              />
              <TokenButtons
                tokens={spec.subjectTokens}
                onInsert={(token) =>
                  patch({
                    subject: insertToken(channel.subject, token, subjectEl),
                  })
                }
              />
              <p className="mt-1 text-right text-[11px] text-neutral-400">
                {channel.subject.trim().length}/{EMAIL_SUBJECT_MAX}
              </p>
            </label>
          )}
          {showBody && (
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Message</span>
              <textarea
                ref={setBodyEl}
                value={channel.body}
                rows={spec.kind === "sms" ? 4 : 6}
                maxLength={bodyMax}
                onChange={(event) => patch({ body: event.target.value })}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              />
              <TokenButtons
                tokens={spec.bodyTokens}
                onInsert={(token) =>
                  patch({ body: insertToken(channel.body, token, bodyEl) })
                }
              />
              <p className="mt-1 text-right text-[11px] text-neutral-400">
                {channel.body.trim().length}/{bodyMax.toLocaleString()}
              </p>
            </label>
          )}
        </div>
      )}
      {spec.hint && (
        <p className="mt-3 text-xs text-neutral-500">{spec.hint}</p>
      )}
    </div>
  );
}

export default function AutomatedMessagesCard({
  token,
}: {
  token: string | null;
}) {
  const [settings, setSettings] = useState<AutomatedMessageSettings | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [templates, setTemplates] = useState<MessageTemplateItem[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [messageSettings, templateResult] = await Promise.all([
          getAutomatedMessageSettings(token!),
          getMessageTemplates(token!).catch(() => null),
        ]);
        if (cancelled) return;
        setSettings(messageSettings);
        setSavedSnapshot(editableSnapshot(messageSettings));
        setTemplates(templateResult?.templates ?? []);
        setTemplatesLoaded(templateResult !== null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load automated messages.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function updateChannel(key: ChannelKey, next: AutomatedMessageChannel) {
    setSettings((current) => (current ? { ...current, [key]: next } : current));
    setSaveSuccess(false);
    setSaveError(null);
  }

  const problems = settings
    ? (Object.keys(CHANNELS) as ChannelKey[])
        .map((key) => {
          const message = channelError(
            key,
            settings[key],
            templates,
            templatesLoaded,
          );
          return message ? `${CHANNELS[key].label} (${SECTIONS.find((section) => section.keys.includes(key))?.title ?? key}): ${message}` : null;
        })
        .filter((message): message is string => Boolean(message))
    : [];
  const dirty = settings ? editableSnapshot(settings) !== savedSnapshot : false;

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!token || !settings || problems.length > 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const saved = await saveAutomatedMessageSettings(token, settings);
      setSettings(saved);
      setSavedSnapshot(editableSnapshot(saved));
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save automated messages.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 shadow-sm">
        Loading automated messages…
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-sm text-red-700 shadow-sm">
        {error ?? "Failed to load automated messages."}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-neutral-100 px-6 py-4">
        <div className="rounded-lg bg-orange-100 p-2 text-brand-orange">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Automated messages
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Choose a Messaging Hub template, or write the wording here. Editing
            a template later changes every message that uses it. These messages
            still send the same way they do now.
          </p>
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-6 px-6 py-5">
        {!settings.saved && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            These are the messages going out today. Save to keep a choice, or
            switch any message to a template or your own wording.
          </p>
        )}
        {saveError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Automated messages saved.
          </div>
        )}
        {!templatesLoaded && (
          <p className="text-sm text-amber-700">
            Templates could not be loaded. Custom wording can still be saved.
          </p>
        )}

        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-brand-dark">
                {section.title}
              </h3>
              <p className="mt-0.5 text-sm text-neutral-500">
                {section.description}
              </p>
            </div>
            {section.keys.map((key) => (
              <ChannelEditor
                key={key}
                channelKey={key}
                channel={settings[key]}
                templates={templates}
                onChange={(next) => updateChannel(key, next)}
              />
            ))}
          </section>
        ))}

        {problems.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-600">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !dirty || problems.length > 0}
            className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
