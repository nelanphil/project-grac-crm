"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Mail, MessageSquare, Send } from "lucide-react";
import EmailPreview from "@/components/messaging/EmailPreview";
import EmailBodyEditor from "@/components/messaging/EmailBodyEditor";
import PhonePreview from "@/components/messaging/PhonePreview";
import { useAuthStore } from "@/store/useAuthStore";
import { isEmailBodyEmpty, type EmailChrome } from "@/lib/emailChrome";
import {
  ApiError,
  CustomerContact,
  EmailPreviewResult,
  EmailSendAccountItem,
  getCustomerContacts,
  getEmailSendAccounts,
  getInvoiceMessageDefaults,
  getMessageTemplates,
  getTwilioAccounts,
  InvoiceItem,
  InvoiceMessageDefaults,
  MessageTemplateItem,
  MessagingPreviewResult,
  previewEmailMessage,
  previewMessagingMessage,
  saveInvoiceMessageDefaults,
  sendEmailMessages,
  sendMessagingMessages,
  TwilioAccountItem,
} from "@/lib/api";
import { formatUsPhoneInput, isValidUsPhone } from "@/lib/formatPhone";
import {
  hasValidContactEmail,
  invoiceEmailBodyHtml,
  invoiceEmailSubject,
  invoiceSmsBody,
  isInvoicePayable,
  pickInvoiceEmailContact,
  pickInvoicePhoneContact,
} from "@/lib/invoiceEmailHtml";

type Channel = "email" | "text";

type SmsFromOption = {
  key: string;
  accountId: string;
  fromNumber: string;
  label: string;
};

const SMS_BODY_MAX = 1600;
const EMPTY_DEFAULTS: InvoiceMessageDefaults = {
  emailTemplateId: null,
  smsTemplateId: null,
};

const outlineButton =
  "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";
const primaryButton =
  "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";
const fieldClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none focus:border-brand-orange";

function contactName(contact: CustomerContact): string {
  return [contact.first, contact.last].filter(Boolean).join(" ").trim();
}

function setupFailure(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function smsFromOptions(accounts: TwilioAccountItem[]): SmsFromOption[] {
  const options: SmsFromOption[] = [];
  for (const account of accounts.filter((item) => item.isActive)) {
    const smsLines = account.phoneNumbers.filter((line) => line.sms);
    const lines = smsLines.length > 0 ? smsLines : account.phoneNumbers;
    for (const line of lines) {
      if (!line.phoneNumber) continue;
      const name = line.label || account.friendlyName;
      options.push({
        key: `${account._id}:${line.phoneNumber}`,
        accountId: account._id,
        fromNumber: line.phoneNumber,
        label: name ? `${name} · ${line.phoneNumber}` : line.phoneNumber,
      });
    }
  }
  return options;
}

function templateKind(template: MessageTemplateItem): Channel {
  return template.templateType === "email" ? "email" : "text";
}

function emailDraft(invoice: InvoiceItem, template: MessageTemplateItem | null) {
  if (!template) {
    return {
      templateId: "",
      subject: invoiceEmailSubject(invoice),
      body: invoiceEmailBodyHtml(invoice),
      chrome: null as EmailChrome | null,
    };
  }
  return {
    templateId: template._id,
    subject: template.subject.trim()
      ? template.subject
      : invoiceEmailSubject(invoice),
    body: template.body,
    chrome: template.emailChrome ?? null,
  };
}

function smsDraft(invoice: InvoiceItem, template: MessageTemplateItem | null) {
  if (!template) {
    return { templateId: "", body: invoiceSmsBody(invoice) };
  }
  return { templateId: template._id, body: template.body };
}

export function useInvoiceCustomerSend(
  invoice: InvoiceItem | null,
  enabled: boolean,
) {
  const token = useAuthStore((s) => s.token);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<EmailSendAccountItem[]>(
    [],
  );
  const [emailAccountId, setEmailAccountId] = useState("");
  const [smsOptions, setSmsOptions] = useState<SmsFromOption[]>([]);
  const [smsOptionKey, setSmsOptionKey] = useState("");
  const [readyCustomerRef, setReadyCustomerRef] = useState<string | null>(null);
  const [emailSetupError, setEmailSetupError] = useState<string | null>(null);
  const [textSetupError, setTextSetupError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplateItem[]>([]);
  const [templatesReady, setTemplatesReady] = useState(false);
  const [defaults, setDefaults] = useState<InvoiceMessageDefaults>(EMPTY_DEFAULTS);
  const [seededFor, setSeededFor] = useState("");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [smsTemplateId, setSmsTemplateId] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailChrome, setEmailChrome] = useState<EmailChrome | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const [includePaymentLink, setIncludePaymentLink] = useState(false);
  const [emailPreview, setEmailPreview] = useState<EmailPreviewResult | null>(
    null,
  );
  const [smsPreview, setSmsPreview] = useState<MessagingPreviewResult | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [emailToEdit, setEmailToEdit] = useState<string | null>(null);
  const [phoneToEdit, setPhoneToEdit] = useState<string | null>(null);

  const invoiceId = invoice?._id ?? "";
  const customerRef = invoice?.customerRef ?? "";
  const [trackedInvoiceId, setTrackedInvoiceId] = useState(invoiceId);
  if (trackedInvoiceId !== invoiceId) {
    setTrackedInvoiceId(invoiceId);
    setChannel(null);
    setSent(false);
    setSendError(null);
    setPreviewError(null);
    setPreviewKey("");
    setSeededFor("");
    setEmailToEdit(null);
    setPhoneToEdit(null);
  }
  if (invoice && templatesReady && seededFor !== invoice._id) {
    const emailTemplate =
      templates.find(
        (template) =>
          template._id === defaults.emailTemplateId &&
          templateKind(template) === "email",
      ) ?? null;
    const smsTemplate =
      templates.find(
        (template) =>
          template._id === defaults.smsTemplateId &&
          templateKind(template) === "text",
      ) ?? null;
    const email = emailDraft(invoice, emailTemplate);
    const sms = smsDraft(invoice, smsTemplate);
    setSeededFor(invoice._id);
    setEmailTemplateId(email.templateId);
    setEmailSubject(email.subject);
    setEmailBody(email.body);
    setEmailChrome(email.chrome);
    setSmsTemplateId(sms.templateId);
    setSmsBody(sms.body);
    setIncludePaymentLink(isInvoicePayable(invoice));
  }

  const payable = invoice ? isInvoicePayable(invoice) : false;
  const setupLoading = Boolean(
    enabled && token && customerRef && readyCustomerRef !== customerRef,
  );
  const emailContact = pickInvoiceEmailContact(contacts);
  const phoneContact = pickInvoicePhoneContact(contacts);
  const emailContactId = emailContact?._id ?? "";
  const phoneContactId = phoneContact?._id ?? "";
  const contactEmail = (emailContact?.email ?? "").trim();
  const contactPhone = (phoneContact?.phone ?? "").trim();
  const emailTo = emailToEdit ?? contactEmail;
  const phoneTo = phoneToEdit ?? contactPhone;
  const emailOverride =
    emailToEdit !== null &&
    emailToEdit.trim().toLowerCase() !== contactEmail.toLowerCase()
      ? emailToEdit.trim()
      : undefined;
  const phoneOverride =
    phoneToEdit !== null &&
    phoneToEdit.replace(/\D/g, "") !==
      contactPhone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
      ? phoneToEdit.trim()
      : undefined;
  const emailAccount =
    emailAccounts.find((account) => account._id === emailAccountId) ??
    emailAccounts[0] ??
    null;
  const smsOption =
    smsOptions.find((option) => option.key === smsOptionKey) ??
    smsOptions[0] ??
    null;
  const payLink = payable && includePaymentLink;
  const requestKey = JSON.stringify({
    channel,
    subject: channel === "email" ? emailSubject : "",
    body: channel === "email" ? emailBody : smsBody,
    payLink,
    chrome: channel === "email" ? emailChrome : null,
    contactId: channel === "email" ? emailContactId : phoneContactId,
  });

  useEffect(() => {
    if (!enabled || !token || !customerRef) return;
    let cancelled = false;
    Promise.allSettled([
      getCustomerContacts(token, customerRef),
      getEmailSendAccounts(token),
      getTwilioAccounts(token),
      getMessageTemplates(token),
      getInvoiceMessageDefaults(token),
    ]).then(([contactsRes, emailRes, twilioRes, templateRes, defaultRes]) => {
      if (cancelled) return;
      if (contactsRes.status === "fulfilled") {
        setContacts(contactsRes.value.contacts);
        setEmailSetupError(
          emailRes.status === "fulfilled"
            ? null
            : setupFailure(emailRes.reason, "Failed to load email accounts."),
        );
        setTextSetupError(
          twilioRes.status === "fulfilled"
            ? null
            : setupFailure(twilioRes.reason, "Failed to load texting numbers."),
        );
      } else {
        const message = setupFailure(
          contactsRes.reason,
          "Failed to load contacts.",
        );
        setContacts([]);
        setEmailSetupError(message);
        setTextSetupError(message);
      }
      if (emailRes.status === "fulfilled") {
        const accounts = emailRes.value.accounts.filter(
          (account) => account.isActive,
        );
        setEmailAccounts(accounts);
        setEmailAccountId((current) =>
          accounts.some((account) => account._id === current)
            ? current
            : (accounts[0]?._id ?? ""),
        );
      } else if (contactsRes.status === "fulfilled") {
        setEmailAccounts([]);
      }
      if (twilioRes.status === "fulfilled") {
        const options = smsFromOptions(twilioRes.value.accounts);
        setSmsOptions(options);
        setSmsOptionKey((current) =>
          options.some((option) => option.key === current)
            ? current
            : (options[0]?.key ?? ""),
        );
      } else if (contactsRes.status === "fulfilled") {
        setSmsOptions([]);
      }
      setTemplates(
        templateRes.status === "fulfilled" ? templateRes.value.templates : [],
      );
      setDefaults(
        defaultRes.status === "fulfilled" ? defaultRes.value : EMPTY_DEFAULTS,
      );
      setTemplatesReady(true);
      setReadyCustomerRef(customerRef);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, token, customerRef]);

  useEffect(() => {
    if (!channel || !token || !invoice) return;
    const contactId = channel === "email" ? emailContactId : phoneContactId;
    if (!contactId) return;
    const subject = emailSubject;
    const body = channel === "email" ? emailBody : smsBody;
    const chrome = emailChrome;
    const withPayLink = payLink;
    const key = requestKey;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      if (cancelled) return;
      setPreviewLoading(true);
      setPreviewError(null);
      const request =
        channel === "email"
          ? previewEmailMessage(token, {
              subject,
              body,
              emailChrome: chrome ?? undefined,
              contactId,
              includePaymentLink: withPayLink,
            }).then((result) => {
              if (cancelled) return;
              setEmailPreview(result);
              setSmsPreview(null);
              setPreviewKey(key);
            })
          : previewMessagingMessage(token, {
              body,
              contactId,
              includePaymentLink: withPayLink,
            }).then((result) => {
              if (cancelled) return;
              setSmsPreview(result);
              setEmailPreview(null);
              setPreviewKey(key);
            });
      request
        .catch((err) => {
          if (cancelled) return;
          setPreviewError(
            err instanceof ApiError
              ? err.message
              : "Failed to preview this message.",
          );
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    channel,
    token,
    invoice,
    emailContactId,
    phoneContactId,
    emailSubject,
    emailBody,
    smsBody,
    emailChrome,
    payLink,
    requestKey,
  ]);

  function close() {
    setChannel(null);
    setSent(false);
    setSendError(null);
    setPreviewError(null);
    setDefaultError(null);
  }

  function openChannel(next: Channel) {
    if (channel === next) {
      close();
      return;
    }
    setChannel(next);
    setSent(false);
    setSendError(null);
    setPreviewError(null);
    setDefaultError(null);
  }

  function applyTemplate(id: string) {
    if (!invoice || !channel) return;
    setSent(false);
    setDefaultError(null);
    if (channel === "email") {
      const template = id
        ? (templates.find((item) => item._id === id) ?? null)
        : null;
      const draft = emailDraft(invoice, template);
      setEmailTemplateId(draft.templateId);
      setEmailSubject(draft.subject);
      setEmailBody(draft.body);
      setEmailChrome(draft.chrome);
      return;
    }
    const template = id
      ? (templates.find((item) => item._id === id) ?? null)
      : null;
    const draft = smsDraft(invoice, template);
    setSmsTemplateId(draft.templateId);
    setSmsBody(draft.body);
  }

  async function setAsDefault() {
    if (!token || !channel || defaultSaving) return;
    const selectedId = channel === "email" ? emailTemplateId : smsTemplateId;
    if (!selectedId) return;
    setDefaultSaving(true);
    setDefaultError(null);
    try {
      const saved = await saveInvoiceMessageDefaults(
        token,
        channel === "email"
          ? { emailTemplateId: selectedId }
          : { smsTemplateId: selectedId },
      );
      setDefaults(saved);
    } catch (err) {
      setDefaultError(
        err instanceof ApiError
          ? err.message
          : "Failed to save the default template.",
      );
    } finally {
      setDefaultSaving(false);
    }
  }

  async function clearDefault() {
    if (!token || !channel || defaultSaving) return;
    setDefaultSaving(true);
    setDefaultError(null);
    try {
      const saved = await saveInvoiceMessageDefaults(
        token,
        channel === "email"
          ? { emailTemplateId: null }
          : { smsTemplateId: null },
      );
      setDefaults(saved);
    } catch (err) {
      setDefaultError(
        err instanceof ApiError
          ? err.message
          : "Failed to clear the default template.",
      );
    } finally {
      setDefaultSaving(false);
    }
  }

  async function send() {
    if (!token || !invoice || !channel || sending || recipientError) return;
    const contact = channel === "email" ? emailContact : phoneContact;
    if (!contact) return;
    setSending(true);
    setSendError(null);
    try {
      if (channel === "email") {
        if (!emailAccount) {
          setSendError("No sending email account is configured.");
          return;
        }
        const result = await sendEmailMessages(token, {
          contactIds: [contact._id],
          subject: emailSubject,
          body: emailBody,
          emailChrome: emailChrome ?? undefined,
          emailAccountId: emailAccount._id,
          fromName: emailAccount.fromName,
          includePaymentLink: payLink,
          toOverride: emailOverride,
        });
        const failed = result.results.find((item) => item.status !== "sent");
        if (failed || result.summary.failed > 0) {
          setSendError(failed?.error || "The email was not sent.");
          return;
        }
      } else {
        if (!smsOption) {
          setSendError("No texting number is configured.");
          return;
        }
        const result = await sendMessagingMessages(token, {
          contactIds: [contact._id],
          body: smsBody,
          twilioAccountId: smsOption.accountId,
          fromNumber: smsOption.fromNumber,
          includePaymentLink: payLink,
          toOverride: phoneOverride,
        });
        const failed = result.results.find((item) => item.status !== "sent");
        if (failed || result.summary.failed > 0) {
          setSendError(failed?.error || "The text was not sent.");
          return;
        }
      }
      setSent(true);
    } catch (err) {
      setSendError(
        err instanceof ApiError ? err.message : "Failed to send this message.",
      );
    } finally {
      setSending(false);
    }
  }

  function disabledReason(next: Channel): string | null {
    if (!invoice?.customerRef) {
      return next === "email"
        ? "This invoice has no customer to email."
        : "This invoice has no customer to text.";
    }
    if (setupLoading) return "Loading send options…";
    if (next === "email" && emailSetupError) return emailSetupError;
    if (next === "text" && textSetupError) return textSetupError;
    if (next === "email") {
      if (!emailContact) {
        return "This customer has no contact with a valid email address.";
      }
      if (!emailAccount) return "No sending email account is configured.";
      return null;
    }
    if (!phoneContact) {
      return "This customer has no contact with a mobile number.";
    }
    if (!smsOption) return "No texting number is configured.";
    return null;
  }

  const messageEmpty =
    channel === "email"
      ? !emailSubject.trim() || isEmailBodyEmpty(emailBody)
      : !smsBody.trim() || smsBody.length > SMS_BODY_MAX;
  const previewReady = previewKey === requestKey && !previewError;

  const activeContact = channel === "text" ? phoneContact : emailContact;
  const recipientTo = channel === "text" ? phoneTo : emailTo;
  const recipientError =
    channel === "email" && emailToEdit !== null && !hasValidContactEmail(emailTo)
      ? "Enter a valid email address."
      : channel === "text" && phoneToEdit !== null && !isValidUsPhone(phoneTo)
        ? "Enter a 10-digit phone number."
        : null;
  const recipientLabel = activeContact
    ? [contactName(activeContact), recipientTo.trim()]
        .filter(Boolean)
        .join(" · ")
    : "";

  return {
    enabled,
    channel,
    payable,
    includePaymentLink,
    setIncludePaymentLink: (value: boolean) => {
      setSent(false);
      setIncludePaymentLink(value);
    },
    emailAccounts,
    emailAccount,
    emailAccountId,
    setEmailAccountId,
    smsOptions,
    smsOption,
    smsOptionKey,
    setSmsOptionKey,
    templates,
    defaults,
    emailTemplateId,
    smsTemplateId,
    emailSubject,
    setEmailSubject: (value: string) => {
      setSent(false);
      setEmailSubject(value);
    },
    emailBody,
    setEmailBody: (value: string) => {
      setSent(false);
      setEmailBody(value);
    },
    smsBody,
    setSmsBody: (value: string) => {
      setSent(false);
      setSmsBody(value);
    },
    previewLoading,
    previewError,
    emailPreview,
    smsPreview,
    sending,
    sendError,
    sent,
    defaultSaving,
    defaultError,
    recipientLabel,
    recipientTo,
    recipientError,
    recipientEdited:
      channel === "text" ? phoneOverride !== undefined : emailOverride !== undefined,
    contactRecipient: channel === "text" ? contactPhone : contactEmail,
    setRecipientTo: (value: string) => {
      setSent(false);
      if (channel === "text") {
        const digits = value.replace(/\D/g, "");
        setPhoneToEdit(
          formatUsPhoneInput(
            digits.length === 11 && digits.startsWith("1")
              ? digits.slice(1)
              : value,
          ),
        );
      }
      else if (channel === "email") setEmailToEdit(value);
    },
    resetRecipient: () => {
      setSent(false);
      if (channel === "text") setPhoneToEdit(null);
      else if (channel === "email") setEmailToEdit(null);
    },
    composerOpen: channel !== null,
    canSend: previewReady && !messageEmpty && !sending && !recipientError,
    emailDisabledReason: disabledReason("email"),
    textDisabledReason: disabledReason("text"),
    openChannel,
    applyTemplate,
    setAsDefault,
    clearDefault,
    close,
    send,
  };
}

export type InvoiceSendController = ReturnType<typeof useInvoiceCustomerSend>;

export function InvoiceSendButtons({ send }: { send: InvoiceSendController }) {
  if (!send.enabled) return null;
  const emailActive = send.channel === "email";
  const textActive = send.channel === "text";
  return (
    <>
      <button
        type="button"
        disabled={Boolean(send.emailDisabledReason)}
        title={send.emailDisabledReason ?? "Email this invoice"}
        aria-pressed={emailActive}
        onClick={() => send.openChannel("email")}
        className={`${primaryButton} ${emailActive ? "ring-2 ring-brand-orange" : ""}`}
      >
        <Mail className="h-4 w-4" />
        Email
      </button>
      <button
        type="button"
        disabled={Boolean(send.textDisabledReason)}
        title={send.textDisabledReason ?? "Text this invoice"}
        aria-pressed={textActive}
        onClick={() => send.openChannel("text")}
        className={`${outlineButton} ${textActive ? "ring-2 ring-brand-orange" : ""}`}
      >
        <MessageSquare className="h-4 w-4" />
        Text
      </button>
    </>
  );
}

export function InvoiceSendEditor({ send }: { send: InvoiceSendController }) {
  const [confirmingChannel, setConfirmingChannel] = useState<Channel | null>(
    null,
  );
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  if (!send.channel) return null;
  const editingRecipient =
    editingChannel === send.channel || send.recipientError !== null;
  const isEmail = send.channel === "email";
  const confirming = confirmingChannel === send.channel && send.canSend;
  const templates = send.templates.filter((template) =>
    isEmail
      ? templateKind(template) === "email"
      : templateKind(template) === "text",
  );
  const selectedId = isEmail ? send.emailTemplateId : send.smsTemplateId;
  const defaultId = isEmail
    ? send.defaults.emailTemplateId
    : send.defaults.smsTemplateId;
  const isDefault = Boolean(selectedId) && selectedId === defaultId;
  const showEmailPicker = isEmail && send.emailAccounts.length > 1;
  const showSmsPicker = !isEmail && send.smsOptions.length > 1;
  const fromLabel = isEmail
    ? send.emailAccount
      ? `${send.emailAccount.fromName} <${send.emailAccount.fromEmail}>`
      : ""
    : (send.smsOption?.label ?? "");

  return (
    <div className="min-w-0 rounded-xl border border-neutral-200 bg-white px-4 py-4 text-sm text-neutral-800 shadow-sm print:hidden">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-brand-dark">
          {isEmail ? "Email this invoice" : "Text this invoice"}
        </p>
        <button
          type="button"
          onClick={send.close}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Close
        </button>
      </div>
      {editingRecipient ? (
        <label className="mt-2 block">
          <span className="text-neutral-500">
            {isEmail ? "To email address" : "To phone number"}
          </span>
          <input
            type={isEmail ? "email" : "tel"}
            inputMode={isEmail ? "email" : "tel"}
            autoComplete="off"
            autoFocus
            value={send.recipientTo}
            onChange={(event) => send.setRecipientTo(event.target.value)}
            aria-invalid={send.recipientError ? true : undefined}
            className={fieldClass}
          />
          {send.recipientError ? (
            <span className="mt-1 block text-xs text-red-700">
              {send.recipientError}
            </span>
          ) : send.recipientEdited ? (
            <span className="mt-1 block text-xs text-neutral-500">
              Used for this send only. The customer&apos;s contact keeps{" "}
              {send.contactRecipient || "its saved value"}.
            </span>
          ) : null}
          <span className="mt-1 flex gap-3 text-xs">
            <button
              type="button"
              disabled={Boolean(send.recipientError)}
              onClick={() => setEditingChannel(null)}
              className="font-medium text-brand-orange hover:underline disabled:opacity-60"
            >
              Done
            </button>
            {send.recipientEdited || send.recipientError ? (
              <button
                type="button"
                onClick={() => {
                  send.resetRecipient();
                  setEditingChannel(null);
                }}
                className="font-medium text-neutral-600 hover:underline"
              >
                Reset
              </button>
            ) : null}
          </span>
        </label>
      ) : (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span>
            <span className="text-neutral-500">To </span>
            {send.recipientLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirmingChannel(null);
              send.setRecipientTo(send.recipientTo);
              setEditingChannel(send.channel);
            }}
            className="text-xs font-medium text-brand-orange hover:underline"
          >
            Change
          </button>
          {send.recipientEdited ? (
            <button
              type="button"
              onClick={send.resetRecipient}
              className="text-xs font-medium text-neutral-600 hover:underline"
            >
              Reset
            </button>
          ) : null}
        </p>
      )}
      {showEmailPicker ? (
        <label className="mt-3 block">
          <span className="text-neutral-500">From</span>
          <select
            value={send.emailAccountId}
            onChange={(event) => send.setEmailAccountId(event.target.value)}
            className={fieldClass}
          >
            {send.emailAccounts.map((account) => (
              <option key={account._id} value={account._id}>
                {account.fromName} &lt;{account.fromEmail}&gt;
              </option>
            ))}
          </select>
        </label>
      ) : showSmsPicker ? (
        <label className="mt-3 block">
          <span className="text-neutral-500">From</span>
          <select
            value={send.smsOptionKey}
            onChange={(event) => send.setSmsOptionKey(event.target.value)}
            className={fieldClass}
          >
            {send.smsOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : fromLabel ? (
        <p className="mt-1">
          <span className="text-neutral-500">From </span>
          {fromLabel}
        </p>
      ) : null}

      <label className="mt-4 block">
        <span className="text-neutral-500">Template</span>
        <select
          value={selectedId}
          onChange={(event) => send.applyTemplate(event.target.value)}
          className={fieldClass}
        >
          <option value="">Invoice details</option>
          {templates.map((template) => (
            <option key={template._id} value={template._id}>
              {template.name}
              {template._id === defaultId ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!selectedId || isDefault || send.defaultSaving}
          onClick={() => void send.setAsDefault()}
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          {send.defaultSaving ? "Saving…" : "Set as default"}
        </button>
        {defaultId ? (
          <button
            type="button"
            disabled={send.defaultSaving}
            onClick={() => void send.clearDefault()}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            Clear default
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {isDefault
          ? `This template is the default for invoice ${isEmail ? "emails" : "texts"}.`
          : defaultId
            ? "Clearing the default makes the next invoice message start from the invoice details."
            : "Set a template as the default for every invoice message of this type."}
      </p>
      {send.defaultError ? (
        <p className="mt-2 text-sm text-red-700">{send.defaultError}</p>
      ) : null}

      {isEmail ? (
        <label className="mt-4 block">
          <span className="text-neutral-500">Subject</span>
          <input
            value={send.emailSubject}
            onChange={(event) => send.setEmailSubject(event.target.value)}
            className={fieldClass}
          />
        </label>
      ) : null}
      <div className="mt-4">
        <p className="text-neutral-500">Message</p>
        <div className="mt-1">
          {isEmail ? (
            <EmailBodyEditor
              value={send.emailBody}
              onChange={send.setEmailBody}
              placeholder="Write the invoice email…"
            />
          ) : (
            <>
              <textarea
                value={send.smsBody}
                onChange={(event) => send.setSmsBody(event.target.value)}
                rows={8}
                maxLength={SMS_BODY_MAX}
                className={`${fieldClass} resize-y`}
                placeholder="Write the invoice text…"
              />
              <p className="mt-1 text-right text-[11px] text-neutral-400">
                {send.smsBody.length}/{SMS_BODY_MAX}
              </p>
            </>
          )}
        </div>
      </div>

      {send.payable ? (
        <label className="mt-4 flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <input
            type="checkbox"
            checked={send.includePaymentLink}
            onChange={(event) =>
              send.setIncludePaymentLink(event.target.checked)
            }
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-brand-dark">
              Include a payment link
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              The link covers their unpaid balance, including this invoice.
            </span>
          </span>
        </label>
      ) : (
        <p className="mt-4 text-xs text-neutral-500">
          This invoice is not payable, so the message will not include a
          payment link.
        </p>
      )}

      {send.sendError ? (
        <p className="mt-3 text-sm text-red-700">{send.sendError}</p>
      ) : null}
      {send.sent ? (
        <p className="mt-3 text-sm text-emerald-700">
          Sent to {send.recipientLabel}.
        </p>
      ) : null}
      <div className="mt-4">
        {send.sent ? (
          <button
            type="button"
            onClick={send.close}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Done
          </button>
        ) : confirming ? (
          <div
            role="alertdialog"
            aria-label={isEmail ? "Confirm sending email" : "Confirm sending text"}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3"
          >
            <p className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                This will immediately {isEmail ? "email" : "text"} this invoice
                to <span className="font-medium">{send.recipientLabel}</span>.
                Click OK to continue.
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setConfirmingChannel(null);
                  void send.send();
                }}
                className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => setConfirmingChannel(null)}
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!send.canSend}
            onClick={() => setConfirmingChannel(send.channel)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <Send className="h-4 w-4" aria-hidden />
            {send.sending
              ? "Sending…"
              : isEmail
                ? "Send email"
                : "Send text"}
          </button>
        )}
      </div>
    </div>
  );
}

export function InvoiceSendPreview({ send }: { send: InvoiceSendController }) {
  if (!send.composerOpen || !send.channel) return null;
  const isEmail = send.channel === "email";
  const fromLabel = send.emailAccount
    ? `${send.emailAccount.fromName} <${send.emailAccount.fromEmail}>`
    : undefined;

  return (
    <div className="min-w-0 space-y-3 print:hidden">
      <p className="text-xs text-neutral-400">
        {send.previewLoading
          ? "Updating preview…"
          : send.includePaymentLink && send.payable
            ? "Payment link included for their unpaid balance, including this invoice."
            : "No payment link."}
      </p>
      {send.previewError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {send.previewError}
        </p>
      ) : isEmail && send.emailPreview ? (
        <EmailPreview
          fullWidth
          frameClassName="h-[70vh] min-h-[620px] w-full border-0 bg-white"
          fromLabel={fromLabel}
          toLabel={send.recipientLabel}
          subject={send.emailPreview.renderedSubject}
          html={send.emailPreview.html}
          isSample={send.emailPreview.sample}
        />
      ) : send.smsPreview ? (
        <PhonePreview
          message={send.smsPreview.rendered}
          contactLabel={send.recipientLabel}
          isSample={send.smsPreview.sample}
        />
      ) : (
        <p className="text-sm text-neutral-500">Loading preview…</p>
      )}
    </div>
  );
}
