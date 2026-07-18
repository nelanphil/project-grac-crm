import { z } from "zod";

export const createContractTemplateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  body: z.string().max(50000).optional().default(""),
  cost: z.number().min(0).optional().default(0),
  badgeIcon: z.string().trim().min(1).max(80).optional().default("scroll-text"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens")
    .max(80)
    .optional(),
});

export const updateContractTemplateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(50000).optional(),
  cost: z.number().min(0).optional(),
  badgeIcon: z.string().trim().min(1).max(80).optional(),
});
