import { z } from "zod";
import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  SMS_BODY_MAX,
} from "./messageTemplate.schema";
import type { AutomatedMessageKind } from "../utils/automatedMessageCopy";

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
