import { z } from "zod";
import { isFloridaCounty } from "../constants/floridaCounties";

const usernameField = z
  .union([
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9_]{2,29}$/,
        "Username must be 3–30 characters, start with a letter, and contain only letters, numbers, or underscores"
      ),
    z.literal(""),
    z.null(),
  ])
  .optional();

const territoriesSchema = z
  .object({
    counties: z.array(z.string()).optional().default([]),
    zips: z.array(z.string()).optional().default([]),
  })
  .superRefine((val, ctx) => {
    for (const county of val.counties ?? []) {
      if (county.trim() && !isFloridaCounty(county)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${county}" is not a valid Florida county`,
          path: ["counties"],
        });
      }
    }
  })
  .optional();

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long")
    .optional(),
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  role: z.string().min(1, "Role is required"),
  username: usernameField,
  territories: territoriesSchema,
});

export const updateUserSchema = z.object({
  email: z.string().email("Invalid email address").optional(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).optional(),
  username: usernameField,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long")
    .optional(),
  territories: territoriesSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
