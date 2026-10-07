import { z } from "zod";

export const MESSAGE_TEMPLATE_TYPES = ["sms", "email"] as const;
export const SMS_BODY_MAX = 1600;
export const EMAIL_BODY_MAX = 25_000;
export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_CHROME_HTML_MAX = 10_000;
export const UNSUBSCRIBE_NOTE_MAX = 400;

export const emailChromeSchema = z.object({
  headerHtml: z.string().max(EMAIL_CHROME_HTML_MAX),
  footerHtml: z.string().max(EMAIL_CHROME_HTML_MAX),
  unsubscribeNote: z.string().max(UNSUBSCRIBE_NOTE_MAX).optional(),
});

export const offerContractTemplateIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid contract template")
  .nullable();

export const offerContractOverrideSchema = z.object({
  contactId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/),
  contractTemplateId: offerContractTemplateIdSchema,
});

function refineBodyMax(
  data: { templateType?: "sms" | "email"; body?: string },
  ctx: z.RefinementCtx,
) {
  const type = data.templateType ?? "sms";
  const max = type === "email" ? EMAIL_BODY_MAX : SMS_BODY_MAX;
  const body = data.body ?? "";
  if (body.length > max) {
    ctx.addIssue({
      code: "custom",
      path: ["body"],
      message: `Body must be at most ${max} characters`,
    });
  }
}

export const createMessageTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    body: z.string().optional().default(""),
    subject: z.string().max(EMAIL_SUBJECT_MAX).optional().default(""),
    templateType: z.enum(MESSAGE_TEMPLATE_TYPES).optional().default("sms"),
    emailChrome: emailChromeSchema.optional(),
    offerContractTemplateId: offerContractTemplateIdSchema.optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens")
      .max(80)
      .optional(),
  })
  .superRefine(refineBodyMax);

export const updateMessageTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    body: z.string().optional(),
    subject: z.string().max(EMAIL_SUBJECT_MAX).optional(),
    templateType: z.enum(MESSAGE_TEMPLATE_TYPES).optional(),
    emailChrome: emailChromeSchema.optional(),
    offerContractTemplateId: offerContractTemplateIdSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.body === undefined) return;
    // When type is omitted, allow the email max; the controller enforces SMS 1600
    // against the persisted template type after merge.
    const max =
      data.templateType === "sms" ? SMS_BODY_MAX : EMAIL_BODY_MAX;
    if (data.body.length > max) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: `Body must be at most ${max} characters`,
      });
    }
  });

export const messagingPreviewSchema = z
  .object({
    body: z.string().max(1600),
    contactId: z.string().trim().min(1).optional(),
    renewalYear: z.number().int().min(1970).max(2100).optional(),
    renewalMonth: z.number().int().min(1).max(12).optional(),
    includePaymentLink: z.boolean().optional(),
    offerContractTemplateId: offerContractTemplateIdSchema.optional(),
  })
  .refine(
    (data) =>
      (data.renewalYear === undefined && data.renewalMonth === undefined) ||
      (data.renewalYear !== undefined && data.renewalMonth !== undefined),
    {
      message: "Both renewalYear and renewalMonth are required together",
      path: ["renewalMonth"],
    },
  );

export const messagingSendSchema = z
  .object({
    contactIds: z.array(z.string().trim().min(1)).min(1).max(200),
    body: z.string().max(1600).optional(),
    templateId: z.string().trim().min(1).optional(),
    threadId: z.string().trim().min(1).optional(),
    twilioAccountId: z.string().trim().min(1).optional(),
    fromNumber: z.string().trim().min(1).optional(),
    mediaUrls: z
      .array(z.string().trim().url().max(2000))
      .max(10)
      .optional()
      .default([]),
    renewalYear: z.number().int().min(1970).max(2100).optional(),
    renewalMonth: z.number().int().min(1).max(12).optional(),
    includePaymentLink: z.boolean().optional(),
    offerContractTemplateId: offerContractTemplateIdSchema.optional(),
    offerContractOverrides: z
      .array(offerContractOverrideSchema)
      .max(200)
      .optional(),
  })
  .refine((data) => Boolean(data.body?.trim()) || Boolean(data.templateId), {
    message: "Either body or templateId is required",
    path: ["body"],
  })
  .refine(
    (data) =>
      (data.renewalYear === undefined && data.renewalMonth === undefined) ||
      (data.renewalYear !== undefined && data.renewalMonth !== undefined),
    {
      message: "Both renewalYear and renewalMonth are required together",
      path: ["renewalMonth"],
    },
  )
  .refine((data) => !data.threadId || data.contactIds.length === 1, {
    message: "threadId can only be used when sending to a single contact",
    path: ["threadId"],
  });

const invoiceTemplateIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid message template")
  .nullable();

export const invoiceMessageDefaultsSchema = z
  .object({
    emailTemplateId: invoiceTemplateIdSchema.optional(),
    smsTemplateId: invoiceTemplateIdSchema.optional(),
  })
  .refine(
    (data) =>
      data.emailTemplateId !== undefined || data.smsTemplateId !== undefined,
    { message: "Choose a template to update" },
  );

export const messagingCallSchema = z.object({
  contactId: z.string().trim().min(1),
  twilioAccountId: z.string().trim().min(1).optional(),
  fromNumber: z.string().trim().min(1).optional(),
  sayText: z.string().trim().min(1).max(500).optional(),
});
