import { z } from "zod";

export const loginSchema = z
  .object({
    // Accept `identifier` (current client) or `email` (legacy client) so that
    // stale deployed frontends can still authenticate.
    identifier: z.string().min(1).max(200).optional(),
    email: z.string().min(1).max(200).optional(),
    password: z.string().min(1, "Password is required"),
  })
  .transform((data) => ({
    identifier: (data.identifier ?? data.email ?? "").trim(),
    password: data.password,
  }))
  .refine((data) => data.identifier.length > 0, {
    message: "Email or username is required",
    path: ["identifier"],
  });

/** Bump when Terms or Privacy copy changes and re-acceptance is required. */
export const LEGAL_DOCS_VERSION = "2026-08-03";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long"),
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  role: z.string().min(1).optional().default("agent"),
  acceptTerms: z.literal(true, {
    error: "You must accept the Terms of Service",
  }),
  acceptPrivacy: z.literal(true, {
    error: "You must accept the Privacy Policy",
  }),
  smsOptIn: z.boolean().optional().default(false),
});

export const legalConsentSchema = z.object({
  acceptTerms: z.literal(true, {
    error: "You must accept the Terms of Service",
  }),
  acceptPrivacy: z.literal(true, {
    error: "You must accept the Privacy Policy",
  }),
  smsOptIn: z.boolean().optional().default(false),
});

const usernameField = z
  .union([
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9_]{2,29}$/,
        "Username must be 3–30 characters, start with a letter, and contain only letters, numbers, or underscores",
      ),
    z.literal(""),
    z.null(),
  ])
  .optional();

export const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  email: z.string().email("Invalid email address").optional(),
  username: usernameField,
});

export const updatePasswordSchema = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .max(100),
});

export const updateRoleSchema = z.object({
  role: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LegalConsentInput = z.infer<typeof legalConsentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
