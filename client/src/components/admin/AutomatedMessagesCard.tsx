"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import {
  ApiError,
  getAutomatedMessageSettings,
  getMessageTemplates,
  saveAutomatedMessageSettings,
  sendAutomatedMessageTest,
  type AutomatedEmailDelivery,
  type AutomatedMessageChannel,
  type AutomatedMessageSettings,
  type MessageTemplateItem,
} from "@/lib/api";
import MobileTabBar from "@/components/ui/MobileTabBar";

const EMAIL_SUBJECT_MAX = 200;
const EMAIL_BODY_MAX = 25_000;
const SMS_BODY_MAX = 1600;

type ChannelKey = Exclude<
  keyof AutomatedMessageSettings,
  "saved" | "renewalSchedule" | "emailDelivery"
>;

type EmailChannelKey = Exclude<keyof AutomatedEmailDelivery, "enabled">;

const EMAIL_CHANNELS = new Set<ChannelKey>([
  "workOrderCompleteEmail",
  "paymentReceivedEmail",
  "paidInvoiceReceiptEmail",
  "mailboxReply",
  "renewalScheduleEmail",
  "appointmentConfirmationEmail",
]);

function isEmailChannel(key: ChannelKey): key is EmailChannelKey {
  return EMAIL_CHANNELS.has(key);
}
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
const CONTRACT_TYPE: TokenDef = { key: "contract_type", label: "Contract type" };
const RECOMMENDED_DATES: TokenDef = {
  key: "recommended_dates",
  label: "Recommended dates",
};
const APPOINTMENT_DATE: TokenDef = {
  key: "appointment_date",
  label: "Appointment date",
};
const APPOINTMENT_TIME: TokenDef = {
  key: "appointment_time",
  label: "Appointment time",
};
const TECHNICIAN_NAME: TokenDef = {
  key: "technician_name",
  label: "Technician",
};
const SERVICE_ADDRESS: TokenDef = {
  key: "service_address",
  label: "Service address",
};

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
  renewalScheduleEmail: {
    label: "Email",
    kind: "email",
    templateKind: "email",
    subjectTokens: [INVOICE_NUMBER, CONTRACT_TYPE],
    bodyTokens: [FIRST_NAME, INVOICE_NUMBER, CONTRACT_TYPE, RECOMMENDED_DATES],
    hint: "Put {{recommended_dates}} where the date buttons should appear. Turning recommended dates off leaves that spot blank, and the customer can still call to schedule.",
  },
  appointmentConfirmationEmail: {
    label: "Email",
    kind: "email",
    templateKind: "email",
    subjectTokens: [APPOINTMENT_DATE],
    bodyTokens: [
      FIRST_NAME,
      APPOINTMENT_DATE,
      APPOINTMENT_TIME,
      TECHNICIAN_NAME,
      SERVICE_ADDRESS,
    ],
    hint: "{{appointment_time}} already includes \"at\" or \"between\", and it is blank when no time is set.",
  },
  appointmentConfirmationSms: {
    label: "Text",
    kind: "sms",
    templateKind: "sms",
    subjectTokens: [],
    bodyTokens: [
      FIRST_NAME,
      APPOINTMENT_DATE,
      APPOINTMENT_TIME,
      TECHNICIAN_NAME,
      SERVICE_ADDRESS,
    ],
    hint: "A blank first name removes a leading \"Hi,\". {{appointment_time}} is blank when no time is set.",
  },
};

type MessageTabId =
  | "work-orders"
  | "payment-received"
  | "paid-invoice-receipt"
  | "mailbox-reply"
  | "renewal-scheduling"
  | "appointment-confirmation";

const SECTIONS: {
  id: MessageTabId;
  title: string;
  description: string;
  keys: ChannelKey[];
}[] = [
  {
    id: "work-orders",
    title: "Work orders",
    description:
      "Sent when a work order is marked complete and the invoice is emailed or texted, and again when that invoice is resent. This is the bill they still need to pay. The email can include the invoice and a pay button. The text gets a payment link at the end if {{payment_link}} is not already in the message.",
    keys: ["workOrderCompleteEmail", "workOrderCompleteSms"],
  },
  {
    id: "payment-received",
    title: "Payment received",
    description:
      "Email only, sent once after an online card or checkout payment. Not used for check or cash, and it does not send a text. Custom mode changes the subject; the body stays the paid invoice layout from Billing. Choose a template to write the full email, and include {{invoice}} if that template should show the invoice.",
    keys: ["paymentReceivedEmail"],
  },
  {
    id: "paid-invoice-receipt",
    title: "Paid invoice receipt",
    description:
      "Email and text for check or cash collected at completion, and for sending that receipt again. Separate from Payment received. The email uses the same subject-or-template rule. The text is a thank-you with a link to view the invoice and does not include a payment link.",
    keys: ["paidInvoiceReceiptEmail", "paidInvoiceReceiptSms"],
  },
  {
    id: "mailbox-reply",
    title: "Mailbox reply",
    description:
      "Wording used when an email account acknowledges new mail. The switch stays on that account. The subject is always Re: plus the customer’s subject, and this wording sits inside the usual reply above a quote of their message.",
    keys: ["mailboxReply"],
  },
  {
    id: "renewal-scheduling",
    title: "Renewal scheduling",
    description:
      "Sent after a customer pays an ASC renewal. It offers recommended dates they can click, or asks them to call for immediate scheduling help. Clicking a date sets that day on the work order created when the renewal was paid.",
    keys: ["renewalScheduleEmail"],
  },
  {
    id: "appointment-confirmation",
    title: "Appointment confirmation",
    description:
      "Sent when staff schedule a work order and choose to text or email the customer the date. The date, time or arrival window, technician, and service address are filled in.",
    keys: ["appointmentConfirmationEmail", "appointmentConfirmationSms"],
  },
];

function parseMessageTab(value: string | null): MessageTabId {
  const match = SECTIONS.find((section) => section.id === value);
  return match?.id ?? "work-orders";
}

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
  return JSON.stringify({
    channels,
    renewalSchedule: settings.renewalSchedule,
    emailDelivery: settings.emailDelivery,
  });
}

function ToggleSwatch({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 text-left"
    >
      <span
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand-orange" : "bg-neutral-300"
        }`}
      >
        <span
          className={`pointer-events-none mt-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>
        <span className="block text-sm font-medium text-brand-dark">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-neutral-500">{description}</span>
        ) : null}
      </span>
    </button>
  );
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
  onTest,
  testProblem,
  sending,
  onSendingChange,
}: {
  channelKey: ChannelKey;
  channel: AutomatedMessageChannel;
  templates: MessageTemplateItem[];
  onChange: (next: AutomatedMessageChannel) => void;
  onTest: () => void;
  testProblem: string | null;
  sending?: boolean;
  onSendingChange?: (next: boolean) => void;
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
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-brand-dark">{spec.label}</h3>
          {onSendingChange ? (
            <ToggleSwatch
              checked={Boolean(sending)}
              label="Send this email"
              onChange={onSendingChange}
            />
          ) : null}
          <button
            type="button"
            onClick={onTest}
            disabled={Boolean(testProblem)}
            title={testProblem ?? undefined}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send test
          </button>
        </div>
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

function TestSendDialog({
  token,
  channelKey,
  channel,
  onClose,
}: {
  token: string;
  channelKey: ChannelKey;
  channel: AutomatedMessageChannel;
  onClose: () => void;
}) {
  const spec = CHANNELS[channelKey];
  const sms = spec.kind === "sms";
  const workOrder =
    channelKey === "workOrderCompleteEmail" ||
    channelKey === "workOrderCompleteSms";
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setSendError(null);
    setSuccess(null);
    try {
      const result = await sendAutomatedMessageTest(token, {
        channel: channelKey,
        mode: channel.mode,
        templateId: channel.templateId,
        subject: channel.subject,
        body: channel.body,
        to,
      });
      setSuccess(result.message);
    } catch (err) {
      setSendError(
        err instanceof ApiError ? err.message : "Failed to send the test.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="automated-test-title"
        className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="automated-test-title"
          className="text-base font-semibold text-brand-dark"
        >
          {sms ? "Send test text" : "Send test email"}
        </h3>
        <p className="mt-1 text-sm text-neutral-500">
          Sends the wording on this screen, filled with sample invoice INV-1042.
          It does not go to a customer and does not mark any invoice sent.
          {workOrder ? " The payment link is a sample and cannot be paid." : ""}
          {channelKey === "renewalScheduleEmail"
            ? " Recommended dates in this test are samples and cannot be booked."
            : ""}
          {channelKey === "appointmentConfirmationEmail" ||
          channelKey === "appointmentConfirmationSms"
            ? " The date, time, technician, and address are samples."
            : ""}
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              {sms ? "Phone number" : "Email"}
            </span>
            <input
              autoFocus
              type={sms ? "tel" : "email"}
              inputMode={sms ? "tel" : "email"}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setSuccess(null);
                setSendError(null);
              }}
              placeholder={sms ? "(813) 555-0100" : "you@example.com"}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
            />
          </label>
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}
          {success && <p className="text-sm text-emerald-700">{success}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:text-brand-dark"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={sending || !to.trim()}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
            >
              {sending ? "Sending…" : sms ? "Send text" : "Send email"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AutomatedMessagesCard({
  token,
}: {
  token: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const messageTab = parseMessageTab(searchParams.get("message"));
  const [settings, setSettings] = useState<AutomatedMessageSettings | null>(null);
  const [testing, setTesting] = useState<ChannelKey | null>(null);
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

  function updateEmailDelivery(
    partial: Partial<AutomatedMessageSettings["emailDelivery"]>,
  ) {
    setSettings((current) => {
      if (!current) return current;
      const emailDelivery = { ...current.emailDelivery, ...partial };
      return {
        ...current,
        emailDelivery,
        renewalSchedule: {
          ...current.renewalSchedule,
          enabled: emailDelivery.renewalScheduleEmail,
        },
      };
    });
    setSaveSuccess(false);
    setSaveError(null);
  }

  function updateRenewalSchedule(
    partial: Partial<AutomatedMessageSettings["renewalSchedule"]>,
  ) {
    setSettings((current) =>
      current
        ? {
            ...current,
            renewalSchedule: { ...current.renewalSchedule, ...partial },
          }
        : current,
    );
    setSaveSuccess(false);
    setSaveError(null);
  }

  function setMessageTab(id: MessageTabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "automated-messages");
    params.set("message", id);
    router.replace(`/dashboard/admin?${params.toString()}`, { scroll: false });
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
    <>
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
            a template later changes every message that uses it. Turn emails off
            here if something should stop going out. Texts are not affected.
          </p>
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-6 px-6 py-5">
        <div className="rounded-lg border border-neutral-200 px-4 py-3">
          <ToggleSwatch
            checked={settings.emailDelivery.enabled}
            label="Send automated emails"
            description="Turn this off to stop every automated email. Texts still go out. Send test still works, so you can check wording while sending is paused."
            onChange={(enabled) => updateEmailDelivery({ enabled })}
          />
          {settings.emailDelivery.enabled ? null : (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Automated emails are paused. Each email below keeps its own switch
              for when you turn this back on.
            </p>
          )}
        </div>

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

        <MobileTabBar className="-mx-1 border-b border-neutral-200">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setMessageTab(section.id)}
              className={`shrink-0 border-b-2 px-2 pb-3 text-sm font-medium transition-colors md:px-1 ${
                messageTab === section.id
                  ? "border-brand-orange text-brand-dark"
                  : "border-transparent text-neutral-500 hover:text-brand-dark"
              }`}
            >
              {section.title}
            </button>
          ))}
        </MobileTabBar>

        {SECTIONS.filter((section) => section.id === messageTab).map((section) => (
          <section key={section.id} className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-brand-dark">
                {section.title}
              </h3>
              <p className="mt-0.5 text-sm text-neutral-500">
                {section.description}
              </p>
            </div>
            {section.id === "renewal-scheduling" ? (
              <div className="rounded-lg border border-neutral-200 px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-brand-dark">
                  <input
                    type="checkbox"
                    checked={settings.renewalSchedule.offerRecommendedDates}
                    disabled={
                      !settings.emailDelivery.enabled ||
                      !settings.emailDelivery.renewalScheduleEmail
                    }
                    onChange={(event) =>
                      updateRenewalSchedule({
                        offerRecommendedDates: event.target.checked,
                      })
                    }
                    className="h-4 w-4"
                  />
                  Offer recommended schedule dates
                </label>
              </div>
            ) : null}
            {section.keys.map((key) => (
              <ChannelEditor
                key={key}
                channelKey={key}
                channel={settings[key]}
                templates={templates}
                testProblem={channelError(
                  key,
                  settings[key],
                  templates,
                  templatesLoaded,
                )}
                sending={isEmailChannel(key) ? settings.emailDelivery[key] : undefined}
                onSendingChange={
                  isEmailChannel(key)
                    ? (next) => updateEmailDelivery({ [key]: next })
                    : undefined
                }
                onTest={() => setTesting(key)}
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
      {testing && token && settings && (
        <TestSendDialog
          token={token}
          channelKey={testing}
          channel={settings[testing]}
          onClose={() => setTesting(null)}
        />
      )}
    </>
  );
}
