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

const hhMm = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm");

const weeklyDaySchema = z.object({
  enabled: z.boolean(),
  start: hhMm,
  end: hhMm,
});

const weeklyHoursSchema = z
  .object({
    sun: weeklyDaySchema,
    mon: weeklyDaySchema,
    tue: weeklyDaySchema,
    wed: weeklyDaySchema,
    thu: weeklyDaySchema,
    fri: weeklyDaySchema,
    sat: weeklyDaySchema,
  })
  .optional();

const homeLocationSchema = z
  .object({
    address: z.string().trim().max(300).optional().default(""),
    city: z.string().trim().max(120).optional().default(""),
    state: z.string().trim().max(40).optional().default(""),
    zip: z.string().trim().max(20).optional().default(""),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
  })
  .optional();

const scheduleExceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  type: z.enum(["off", "custom"]),
  start: hhMm.optional(),
  end: hhMm.optional(),
  note: z.string().trim().max(200).optional().default(""),
});

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
  schedulable: z.boolean().optional(),
  weeklyHours: weeklyHoursSchema,
  homeLocation: homeLocationSchema,
  scheduleExceptions: z.array(scheduleExceptionSchema).optional(),
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
  schedulable: z.boolean().optional(),
  weeklyHours: weeklyHoursSchema,
  homeLocation: homeLocationSchema,
  scheduleExceptions: z.array(scheduleExceptionSchema).optional(),
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
