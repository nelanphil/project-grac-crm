import { Types } from "mongoose";
import {
  AUTOMATED_MESSAGE_SETTINGS_SLUG,
  AutomatedMessageSettings,
  type AutomatedEmailChannelKey,
  type IAutomatedEmailDelivery,
  type IAutomatedMessageChannel,
} from "../models/mongo/AutomatedMessageSettings";
import {
  INVOICE_MESSAGE_SETTINGS_SLUG,
  InvoiceMessageSettings,
} from "../models/mongo/InvoiceMessageSettings";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import type { IInvoice } from "../models/mongo/Invoice";
import type { SaveAutomatedMessageSettingsInput } from "../schemas/automatedMessage.schema";
import type { EmailChrome } from "../utils/emailChrome";
import {
  AUTOMATED_MESSAGE_CHANNELS,
  AUTOMATED_MESSAGE_FALLBACK,
  AUTOMATED_MESSAGE_KIND,
  applyInvoiceTokens,
  formatMailboxReplyHtml,
  resolveChannelCopy,
  templateUsesInvoiceViewUrl,
  type AutomatedMessageChannelKey,
  type AutomatedMessageKind,
  type AutomatedMessageMode,
  type AutomatedSavedChannel,
  type AutomatedTemplateCopy,
  type ResolvedAutomatedMessage,
} from "../utils/automatedMessageCopy";
import { renderMessageTemplate, stripInvoiceToken } from "../utils/messageTemplate";
import {
  buildInvoiceViewUrl,
  ensureInvoiceViewToken,
} from "../utils/checkoutKey";

export class AutomatedMessageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AutomatedMessageError";
    this.status = status;
  }
}

export type AutomatedMessageChannelForm = {
  mode: AutomatedMessageMode;
  templateId: string | null;
  subject: string;
  body: string;
  templateMissing: boolean;
};

export type RenewalScheduleOptions = {
  enabled: boolean;
  offerRecommendedDates: boolean;
};

export type EmailDeliveryOptions = IAutomatedEmailDelivery;

export type AutomatedMessageForm = {
  saved: boolean;
  renewalSchedule: RenewalScheduleOptions;
  emailDelivery: EmailDeliveryOptions;
} & Record<AutomatedMessageChannelKey, AutomatedMessageChannelForm>;

type LiveTemplate = AutomatedTemplateCopy & {
  id: string;
  templateType: "email" | "sms";
};

const TEMPLATE_KIND: Record<AutomatedMessageKind, "email" | "sms"> = {
  email: "email",
  sms: "sms",
  "receipt-email": "email",
  mailbox: "email",
};

function templateTypeOf(value: unknown): "email" | "sms" {
  return value === "email" ? "email" : "sms";
}

function readChannel(value: unknown): IAutomatedMessageChannel {
  const row =
    value && typeof value === "object"
      ? (value as Partial<IAutomatedMessageChannel>)
      : {};
  const templateRef =
    row.templateRef && Types.ObjectId.isValid(String(row.templateRef))
      ? new Types.ObjectId(String(row.templateRef))
      : null;
  return {
    mode: row.mode === "template" ? "template" : "custom",
    templateRef,
    subject: typeof row.subject === "string" ? row.subject : "",
    body: typeof row.body === "string" ? row.body : "",
  };
}

async function loadLiveTemplate(id: unknown): Promise<LiveTemplate | null> {
  if (!id || !Types.ObjectId.isValid(String(id))) return null;
  const template = await MessageTemplate.findOne({
    _id: id,
    deletedAt: null,
  })
    .select("subject body emailChrome templateType")
    .lean();
  if (!template) return null;
  return {
    id: String(template._id),
    templateType: templateTypeOf(template.templateType),
    subject: template.subject ?? "",
    body: template.body ?? "",
    emailChrome: (template.emailChrome as EmailChrome | null) ?? null,
  };
}

async function loadLegacyTemplates(): Promise<{
  email: LiveTemplate | null;
  sms: LiveTemplate | null;
}> {
  const settings = await InvoiceMessageSettings.findOne({
    slug: INVOICE_MESSAGE_SETTINGS_SLUG,
  }).lean();
  const [email, sms] = await Promise.all([
    loadLiveTemplate(settings?.emailTemplateRef),
    loadLiveTemplate(settings?.smsTemplateRef),
  ]);
  return {
    email: email?.templateType === "email" ? email : null,
    sms: sms?.templateType === "sms" ? sms : null,
  };
}

export function readRenewalScheduleOptions(value: unknown): RenewalScheduleOptions {
  const row =
    value && typeof value === "object"
      ? (value as Partial<RenewalScheduleOptions>)
      : {};
  return {
    enabled: row.enabled !== false,
    offerRecommendedDates: row.offerRecommendedDates !== false,
  };
}

const EMAIL_PAUSED = "Automated emails are turned off.";
const EMAIL_CHANNEL_PAUSED = "This email is turned off in Automated messages.";

/** Missing switches stay on. A renewal email turned off before this switch stays off. */
export function readEmailDelivery(
  value: unknown,
  renewalEnabled = true,
): EmailDeliveryOptions {
  const row =
    value && typeof value === "object"
      ? (value as Partial<EmailDeliveryOptions>)
      : {};
  const on = (key: AutomatedEmailChannelKey) => row[key] !== false;
  return {
    enabled: row.enabled !== false,
    workOrderCompleteEmail: on("workOrderCompleteEmail"),
    paymentReceivedEmail: on("paymentReceivedEmail"),
    paidInvoiceReceiptEmail: on("paidInvoiceReceiptEmail"),
    mailboxReply: on("mailboxReply"),
    renewalScheduleEmail: on("renewalScheduleEmail") && renewalEnabled,
  };
}

export function automatedEmailPauseReason(
  delivery: EmailDeliveryOptions,
  channel: AutomatedEmailChannelKey,
): string | null {
  if (!delivery.enabled) return EMAIL_PAUSED;
  if (!delivery[channel]) return EMAIL_CHANNEL_PAUSED;
  return null;
}

export async function automatedEmailPauseReasonFor(
  channel: AutomatedEmailChannelKey,
): Promise<string | null> {
  const doc = await AutomatedMessageSettings.findOne({
    slug: AUTOMATED_MESSAGE_SETTINGS_SLUG,
  })
    .select("emailDelivery renewalSchedule")
    .lean();
  const renewal = readRenewalScheduleOptions(doc?.renewalSchedule);
  return automatedEmailPauseReason(
    readEmailDelivery(doc?.emailDelivery, renewal.enabled),
    channel,
  );
}

function blankChannel(
  key: AutomatedMessageChannelKey,
  mode: AutomatedMessageMode = "custom",
  templateId: string | null = null,
): AutomatedMessageChannelForm {
  const fallback = AUTOMATED_MESSAGE_FALLBACK[key];
  return {
    mode,
    templateId,
    subject: fallback.subject,
    body: fallback.body,
    templateMissing: false,
  };
}

function savedChannelForm(
  key: AutomatedMessageChannelKey,
  stored: IAutomatedMessageChannel,
  live: LiveTemplate | null,
): AutomatedMessageChannelForm {
  const kind = AUTOMATED_MESSAGE_KIND[key];
  const expected = TEMPLATE_KIND[kind];
  const templateId = stored.templateRef ? String(stored.templateRef) : null;
  const matches = Boolean(live && live.templateType === expected);
  return {
    mode: stored.mode,
    templateId,
    subject: stored.subject,
    body: stored.body,
    templateMissing: stored.mode === "template" && Boolean(templateId) && !matches,
  };
}

export async function getAutomatedMessageForm(): Promise<AutomatedMessageForm> {
  const doc = await AutomatedMessageSettings.findOne({
    slug: AUTOMATED_MESSAGE_SETTINGS_SLUG,
  }).lean();
  if (!doc?.configured) {
    const legacy = await loadLegacyTemplates();
    return {
      saved: false,
      workOrderCompleteEmail: blankChannel(
        "workOrderCompleteEmail",
        legacy.email ? "template" : "custom",
        legacy.email?.id ?? null,
      ),
      workOrderCompleteSms: blankChannel(
        "workOrderCompleteSms",
        legacy.sms ? "template" : "custom",
        legacy.sms?.id ?? null,
      ),
      paymentReceivedEmail: blankChannel("paymentReceivedEmail"),
      paidInvoiceReceiptEmail: blankChannel("paidInvoiceReceiptEmail"),
      paidInvoiceReceiptSms: blankChannel("paidInvoiceReceiptSms"),
      mailboxReply: blankChannel("mailboxReply"),
      renewalScheduleEmail: blankChannel("renewalScheduleEmail"),
      renewalSchedule: readRenewalScheduleOptions(null),
      emailDelivery: readEmailDelivery(null, true),
    };
  }

  const stored = Object.fromEntries(
    AUTOMATED_MESSAGE_CHANNELS.map((key) => {
      const raw = (doc as Record<string, unknown>)[key];
      return [key, raw == null ? null : readChannel(raw)];
    }),
  ) as Record<AutomatedMessageChannelKey, IAutomatedMessageChannel | null>;
  const live = await Promise.all(
    AUTOMATED_MESSAGE_CHANNELS.map((key) =>
      loadLiveTemplate(stored[key]?.templateRef),
    ),
  );
  const channels = Object.fromEntries(
    AUTOMATED_MESSAGE_CHANNELS.map((key, index) => [
      key,
      stored[key]
        ? savedChannelForm(key, stored[key], live[index] ?? null)
        : blankChannel(key),
    ]),
  ) as Record<AutomatedMessageChannelKey, AutomatedMessageChannelForm>;
  const renewalSchedule = readRenewalScheduleOptions(doc.renewalSchedule);
  return {
    saved: true,
    renewalSchedule,
    emailDelivery: readEmailDelivery(doc.emailDelivery, renewalSchedule.enabled),
    ...channels,
  };
}

export async function getRenewalScheduleOptions(): Promise<RenewalScheduleOptions> {
  const doc = await AutomatedMessageSettings.findOne({
    slug: AUTOMATED_MESSAGE_SETTINGS_SLUG,
  })
    .select("renewalSchedule")
    .lean();
  return readRenewalScheduleOptions(doc?.renewalSchedule);
}

async function templateRefFor(
  id: string | null,
  kind: "email" | "sms",
  label: string,
): Promise<Types.ObjectId | null> {
  if (!id) return null;
  const template = await MessageTemplate.findOne({
    _id: id,
    deletedAt: null,
  }).select("templateType");
  if (!template) {
    throw new AutomatedMessageError(`${label} template was not found`);
  }
  if (templateTypeOf(template.templateType) !== kind) {
    throw new AutomatedMessageError(
      kind === "email"
        ? `Choose an email template for ${label}`
        : `Choose a text template for ${label}`,
    );
  }
  return template._id;
}

const CHANNEL_LABEL: Record<AutomatedMessageChannelKey, string> = {
  workOrderCompleteEmail: "the work order email",
  workOrderCompleteSms: "the work order text",
  paymentReceivedEmail: "the payment received email",
  paidInvoiceReceiptEmail: "the paid invoice email",
  paidInvoiceReceiptSms: "the paid invoice text",
  mailboxReply: "the mailbox reply",
  renewalScheduleEmail: "the renewal scheduling email",
};

export async function saveAutomatedMessageForm(
  input: SaveAutomatedMessageSettingsInput,
): Promise<AutomatedMessageForm> {
  const stored: Record<string, IAutomatedMessageChannel> = {};
  for (const key of AUTOMATED_MESSAGE_CHANNELS) {
    const channel = input[key];
    const kind = TEMPLATE_KIND[AUTOMATED_MESSAGE_KIND[key]];
    const templateRef = await templateRefFor(
      channel.templateId,
      kind,
      CHANNEL_LABEL[key],
    );
    if (channel.mode === "template" && !templateRef) {
      throw new AutomatedMessageError(
        `Choose a template for ${CHANNEL_LABEL[key]}`,
      );
    }
    stored[key] = {
      mode: channel.mode,
      templateRef,
      subject: channel.subject,
      body: channel.body,
    };
  }

  await AutomatedMessageSettings.findOneAndUpdate(
    { slug: AUTOMATED_MESSAGE_SETTINGS_SLUG },
    {
      $set: {
        slug: AUTOMATED_MESSAGE_SETTINGS_SLUG,
        configured: true,
        renewalSchedule: {
          enabled: input.emailDelivery.renewalScheduleEmail,
          offerRecommendedDates: input.renewalSchedule.offerRecommendedDates,
        },
        emailDelivery: input.emailDelivery,
        ...stored,
      },
    },
    { upsert: true },
  );
  return getAutomatedMessageForm();
}

export type InvoiceMessageSource = {
  number?: string | null;
  amountCents?: number | null;
  dueDate?: Date | string | null;
  viewUrl?: string | null;
  record?: IInvoice | null;
};

async function viewUrlFor(
  source: InvoiceMessageSource | undefined,
  ...parts: string[]
): Promise<string> {
  const given = source?.viewUrl?.trim() ?? "";
  if (given) return given;
  if (!source?.record || !templateUsesInvoiceViewUrl(...parts)) return "";
  return buildInvoiceViewUrl(await ensureInvoiceViewToken(source.record));
}

export async function resolveDraftAutomatedMessage(
  key: AutomatedMessageChannelKey,
  channel: {
    mode: AutomatedMessageMode;
    templateId: string | null;
    subject: string;
    body: string;
  },
): Promise<ResolvedAutomatedMessage> {
  const kind = AUTOMATED_MESSAGE_KIND[key];
  let selected: LiveTemplate | null = null;
  if (channel.mode === "template") {
    selected = await loadLiveTemplate(channel.templateId);
    const expected = TEMPLATE_KIND[kind];
    if (!selected || selected.templateType !== expected) {
      throw new AutomatedMessageError("That template is no longer available.");
    }
    const needsSubject = kind === "email" || kind === "receipt-email";
    if (needsSubject && !selected.subject.trim()) {
      throw new AutomatedMessageError("That template needs a subject.");
    }
    if (!selected.body.trim()) {
      throw new AutomatedMessageError("That template needs a message.");
    }
  }
  return resolveChannelCopy({
    kind,
    saved: {
      mode: channel.mode,
      subject: channel.subject,
      body: channel.body,
    },
    selectedTemplate: selected,
    legacyTemplate: null,
    fallback: AUTOMATED_MESSAGE_FALLBACK[key],
  });
}

export async function resolveAutomatedMessage(
  key: AutomatedMessageChannelKey,
  source?: InvoiceMessageSource,
): Promise<ResolvedAutomatedMessage> {
  const kind = AUTOMATED_MESSAGE_KIND[key];
  const doc = await AutomatedMessageSettings.findOne({
    slug: AUTOMATED_MESSAGE_SETTINGS_SLUG,
  }).lean();
  const configured = Boolean(doc?.configured);
  const stored = configured ? readChannel(doc?.[key]) : null;
  const selected =
    stored?.mode === "template" ? await loadLiveTemplate(stored.templateRef) : null;
  const selectedMatches =
    selected && selected.templateType === TEMPLATE_KIND[kind] ? selected : null;

  let legacy: LiveTemplate | null = null;
  if (!configured && (key === "workOrderCompleteEmail" || key === "workOrderCompleteSms")) {
    const templates = await loadLegacyTemplates();
    legacy = key === "workOrderCompleteEmail" ? templates.email : templates.sms;
  }

  const saved: AutomatedSavedChannel | null = stored
    ? { mode: stored.mode, subject: stored.subject, body: stored.body }
    : null;
  const resolved = resolveChannelCopy({
    kind,
    saved,
    selectedTemplate: selectedMatches,
    legacyTemplate: legacy,
    fallback: AUTOMATED_MESSAGE_FALLBACK[key],
  });
  const viewUrl = await viewUrlFor(source, resolved.subject, resolved.body);
  const tokens = {
    number: source?.number,
    amountCents: source?.amountCents,
    dueDate: source?.dueDate,
    viewUrl,
  };
  return {
    ...resolved,
    subject: applyInvoiceTokens(resolved.subject, tokens),
    body: applyInvoiceTokens(resolved.body, tokens),
  };
}

export async function resolveMailboxReplyHtml(): Promise<string> {
  const copy = await resolveAutomatedMessage("mailboxReply");
  const rendered = stripInvoiceToken(renderMessageTemplate(copy.body, {}));
  return formatMailboxReplyHtml(rendered);
}
