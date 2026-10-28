import { z } from "zod";
import { BREADCRUMB_TYPES } from "../models/mongo/CrashReport";

const breadcrumbSchema = z.object({
  t: z.number().finite(),
  type: z.enum(BREADCRUMB_TYPES),
  detail: z.string().max(500),
  meta: z
    .object({
      status: z.number().finite().optional(),
      durationMs: z.number().finite().optional(),
      requestId: z.string().max(100).optional(),
      message: z.string().max(300).optional(),
    })
    .optional(),
});

const errorPartSchema = z.object({
  name: z.string().max(200).default(""),
  message: z.string().max(2000).default(""),
  stack: z.string().max(8000).default(""),
});

const additionalErrorSchema = errorPartSchema.extend({
  source: z.string().max(40).default(""),
  at: z.string().max(40).default(""),
});

const scalarRecord = z
  .record(z.string().max(60), z.union([z.string().max(500), z.number().finite(), z.boolean()]))
  .refine((value) => Object.keys(value).length <= 30, "Too many fields");

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().email().max(320).optional(),
);

const optionalNarrative = z.string().trim().max(4000).optional();

export const createCrashReportSchema = z.object({
  clientReportId: z.string().trim().min(8).max(64).optional(),
  release: z.string().trim().max(100).optional(),
  source: z.enum(["render", "window", "unhandledrejection", "chunk"]),
  name: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(16000).optional(),
  componentStack: z.string().max(16000).optional(),
  causes: z.array(errorPartSchema).max(5).optional(),
  context: scalarRecord.optional(),
  additionalErrors: z.array(additionalErrorSchema).max(10).optional(),
  url: z.string().max(2000).optional(),
  pathname: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  viewport: z.string().max(50).optional(),
  online: z.boolean().optional(),
  occurredAt: z.string().max(40).optional(),
  environment: scalarRecord.optional(),
  whatWereYouDoing: optionalNarrative,
  whatHappened: optionalNarrative,
  reporterEmail: optionalEmail,
  breadcrumbs: z.array(breadcrumbSchema).max(100).optional(),
});

export const updateCrashReportSchema = z.object({
  status: z.enum(["open", "resolved"]),
  resolutionNote: z.string().trim().max(4000).optional(),
});

export const uploadSourceMapsSchema = z.object({
  maps: z
    .array(
      z.object({
        file: z.string().trim().min(1).max(500),
        content: z.string().min(2).max(20_000_000),
      }),
    )
    .min(1)
    .max(50),
});

export type CreateCrashReportInput = z.infer<typeof createCrashReportSchema>;
export type UpdateCrashReportInput = z.infer<typeof updateCrashReportSchema>;
