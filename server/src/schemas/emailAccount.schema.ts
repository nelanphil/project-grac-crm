import { z } from "zod";
import { EMAIL_ACCOUNT_ROLES } from "../models/mongo/EmailAccount";

const emailAccountRoleSchema = z.enum(EMAIL_ACCOUNT_ROLES);

export const createEmailAccountSchema = z.object({
  friendlyName: z.string().trim().min(1, "Account name is required").max(120),
  host: z.string().trim().min(1, "SMTP host is required").max(255),
  port: z.coerce.number().int().min(1).max(65535).optional().default(587),
  secure: z.boolean().optional().default(false),
  username: z.string().trim().min(1, "SMTP username is required").max(255),
  password: z.string().min(1, "SMTP password is required"),
  fromName: z.string().trim().min(1, "From name is required").max(120),
  fromEmail: z.string().trim().email("Invalid from email").max(255),
  imapHost: z.string().trim().max(255).optional().default(""),
  imapPort: z.coerce.number().int().min(1).max(65535).optional().default(993),
  imapSecure: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
  roles: z.array(emailAccountRoleSchema).optional().default([]),
});

export const updateEmailAccountSchema = z.object({
  friendlyName: z.string().trim().min(1).max(120).optional(),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().trim().min(1).max(255).optional(),
  // string = set new value, undefined = leave unchanged
  password: z.string().min(1).optional(),
  fromName: z.string().trim().min(1).max(120).optional(),
  fromEmail: z.string().trim().email().max(255).optional(),
  imapHost: z.string().trim().max(255).optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  isActive: z.boolean().optional(),
  autoAcknowledge: z.boolean().optional(),
  roles: z.array(emailAccountRoleSchema).optional(),
});

export const testEmailAccountSchema = z.object({
  to: z.string().trim().email("Invalid recipient email").max(255),
});

export type CreateEmailAccountInput = z.infer<typeof createEmailAccountSchema>;
export type UpdateEmailAccountInput = z.infer<typeof updateEmailAccountSchema>;
export type TestEmailAccountInput = z.infer<typeof testEmailAccountSchema>;
