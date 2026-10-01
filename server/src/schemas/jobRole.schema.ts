import { z } from "zod";
import { JOB_ROLE_FIELD_TYPES } from "../models/mongo/JobRole";

const fieldKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{0,40}$/,
    "Field key must start with a letter and use only letters, numbers, or underscores",
  );

export const jobRoleFieldSchema = z
  .object({
    key: fieldKey,
    label: z.string().trim().min(1).max(80),
    type: z.enum(JOB_ROLE_FIELD_TYPES),
    required: z.boolean().optional().default(false),
    options: z.array(z.string().trim().min(1).max(80)).optional().default([]),
    helpText: z.string().trim().max(240).optional().default(""),
    order: z.number().int().min(0).optional(),
  })
  .superRefine((field, ctx) => {
    if (
      (field.type === "select" || field.type === "multiselect") &&
      field.options.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select fields need at least one option",
        path: ["options"],
      });
    }
  });

const capabilitiesSchema = z.object({
  schedulable: z.boolean(),
  territoryOwner: z.boolean(),
});

const dashboardViewSchema = z.enum(["default", "todo"]);

export const createJobRoleSchema = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240).optional().default(""),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #1e3a5f")
    .optional(),
  capabilities: capabilitiesSchema.optional(),
  dashboardView: dashboardViewSchema.optional().default("default"),
  fields: z.array(jobRoleFieldSchema).optional().default([]),
});

export const updateJobRoleSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(240).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #1e3a5f")
    .optional(),
  capabilities: capabilitiesSchema.optional(),
  dashboardView: dashboardViewSchema.optional(),
  fields: z.array(jobRoleFieldSchema).optional(),
});

export type JobRoleFieldInput = z.infer<typeof jobRoleFieldSchema>;
