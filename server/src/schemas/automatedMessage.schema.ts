import { z } from "zod";
import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  SMS_BODY_MAX,
} from "./messageTemplate.schema";
import {
  AUTOMATED_MESSAGE_CHANNELS,
  AUTOMATED_MESSAGE_KIND,
  type AutomatedMessageKind,
} from "../utils/automatedMessageCopy";

const templateIdSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{24}$/, "Choose a template"),
    z.literal(""),
    z.null(),
  ])
  .transform((value) => (value ? value : null));

function channelSchema(kind: AutomatedMessageKind) {
  const bodyMax = kind === "sms" ? SMS_BODY_MAX : EMAIL_BODY_MAX;
  return z
    .object({
      mode: z.enum(["template", "custom"]),
      templateId: templateIdSchema,
      subject: z
        .string()
        .trim()
        .max(EMAIL_SUBJECT_MAX, "Subject must be 200 characters or fewer"),
      body: z
        .string()
        .trim()
        .max(bodyMax, `Message must be ${bodyMax.toLocaleString()} characters or fewer`),
    })
    .superRefine((data, ctx) => {
      if (data.mode === "template") {
        if (!data.templateId) {
          ctx.addIssue({
            code: "custom",
            path: ["templateId"],
            message: "Choose a template",
          });
        }
        return;
      }
      const needsSubject = kind === "email" || kind === "receipt-email";
      const needsBody = kind === "email" || kind === "sms" || kind === "mailbox";
      if (needsSubject && !data.subject) {
        ctx.addIssue({
          code: "custom",
          path: ["subject"],
          message: "Subject is required",
        });
      }
      if (needsBody && !data.body) {
        ctx.addIssue({
          code: "custom",
          path: ["body"],
          message: "Message is required",
        });
      }
    });
}

export const saveAutomatedMessageSettingsSchema = z.object({
  workOrderCompleteEmail: channelSchema("email"),
  workOrderCompleteSms: channelSchema("sms"),
  paymentReceivedEmail: channelSchema("receipt-email"),
  paidInvoiceReceiptEmail: channelSchema("receipt-email"),
  paidInvoiceReceiptSms: channelSchema("sms"),
  mailboxReply: channelSchema("mailbox"),
});

export type SaveAutomatedMessageSettingsInput = z.infer<
  typeof saveAutomatedMessageSettingsSchema
>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const testAutomatedMessageSchema = z
  .object({
    channel: z.enum(AUTOMATED_MESSAGE_CHANNELS),
    to: z
      .string()
      .trim()
      .min(1, "Enter an email or phone number")
      .max(320),
    mode: z.enum(["template", "custom"]),
    templateId: templateIdSchema,
    subject: z
      .string()
      .trim()
      .max(EMAIL_SUBJECT_MAX, "Subject must be 200 characters or fewer"),
    body: z
      .string()
      .trim()
      .max(
        EMAIL_BODY_MAX,
        `Message must be ${EMAIL_BODY_MAX.toLocaleString()} characters or fewer`,
      ),
  })
  .superRefine((data, ctx) => {
    const parsed = channelSchema(AUTOMATED_MESSAGE_KIND[data.channel]).safeParse({
      mode: data.mode,
      templateId: data.templateId,
      subject: data.subject,
      body: data.body,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
    }
    const sms = AUTOMATED_MESSAGE_KIND[data.channel] === "sms";
    if (sms) {
      if (data.to.replace(/\D/g, "").length !== 10) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "Enter a 10-digit phone number",
        });
      }
      return;
    }
    if (!EMAIL_RE.test(data.to.trim().toLowerCase())) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "Enter a valid email address",
      });
    }
  });

export type TestAutomatedMessageInput = z.infer<
  typeof testAutomatedMessageSchema
>;
