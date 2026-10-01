import { z } from "zod";

const breadcrumbSchema = z.object({
  t: z.number().finite(),
  type: z.enum(["route", "click", "api"]),
  detail: z.string().max(500),
});

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().email().max(320).optional(),
);

export const createCrashReportSchema = z.object({
  source: z.enum(["render", "window", "unhandledrejection", "chunk"]),
  name: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(16000).optional(),
  componentStack: z.string().max(16000).optional(),
  url: z.string().max(2000).optional(),
  pathname: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  viewport: z.string().max(50).optional(),
  online: z.boolean().optional(),
  occurredAt: z.string().max(40).optional(),
  whatWereYouDoing: z.string().trim().min(1, "Describe what you were doing").max(4000),
  whatHappened: z.string().trim().min(1, "Describe what happened").max(4000),
  reporterEmail: optionalEmail,
  breadcrumbs: z.array(breadcrumbSchema).max(40).optional(),
});

export const updateCrashReportSchema = z.object({
  status: z.enum(["open", "resolved"]),
  resolutionNote: z.string().trim().max(4000).optional(),
});

export type CreateCrashReportInput = z.infer<typeof createCrashReportSchema>;
export type UpdateCrashReportInput = z.infer<typeof updateCrashReportSchema>;
