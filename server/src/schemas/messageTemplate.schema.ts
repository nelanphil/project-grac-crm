import { z } from "zod";

export const createMessageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().max(1600).optional().default(""),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens")
    .max(80)
    .optional(),
});

export const updateMessageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(1600).optional(),
});

export const messagingPreviewSchema = z.object({
  body: z.string().max(1600),
  contactId: z.string().trim().min(1).optional(),
  renewalYear: z.number().int().min(1970).max(2100).optional(),
  renewalMonth: z.number().int().min(1).max(12).optional(),
});

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

export const messagingCallSchema = z.object({
  contactId: z.string().trim().min(1),
  twilioAccountId: z.string().trim().min(1).optional(),
  fromNumber: z.string().trim().min(1).optional(),
  sayText: z.string().trim().min(1).max(500).optional(),
});
