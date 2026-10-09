import { z } from "zod";
import { isFloridaCounty } from "../constants/floridaCounties";
import { isUsStateCode } from "../constants/usStates";

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

const SERVICE_CITY_LIMIT = 200;

const serviceCitySchema = z.object({
  city: z.string().trim().min(1).max(120),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isUsStateCode, "State must be a US state code"),
  placeId: z.string().trim().min(1).max(300),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
});

const serviceCitiesSchema = z
  .array(serviceCitySchema)
  .max(SERVICE_CITY_LIMIT, `A technician can cover at most ${SERVICE_CITY_LIMIT} cities`)
  .transform((cities) => {
    const seen = new Set<string>();
    const unique: Array<{
      city: string;
      state: string;
      placeId: string;
      lat: number | null;
      lng: number | null;
    }> = [];
    for (const city of cities) {
      const placeKey = `id:${city.placeId}`;
      const nameKey = `name:${city.city.toLowerCase()}|${city.state}`;
      if (seen.has(placeKey) || seen.has(nameKey)) continue;
      seen.add(placeKey);
      seen.add(nameKey);
      unique.push({
        city: city.city,
        state: city.state,
        placeId: city.placeId,
        lat: typeof city.lat === "number" ? city.lat : null,
        lng: typeof city.lng === "number" ? city.lng : null,
      });
    }
    return unique;
  })
  .optional();

const scheduleExceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  type: z.enum(["off", "custom"]),
  start: hhMm.optional(),
  end: hhMm.optional(),
  note: z.string().trim().max(200).optional().default(""),
});

const rolesField = z.array(z.string().min(1)).min(1).optional();

const jobRoleDataSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .optional();

export const createUserSchema = z
  .object({
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100, "Password is too long")
      .optional(),
    first_name: z.string().min(1, "First name is required").max(100),
    last_name: z.string().min(1, "Last name is required").max(100),
    role: z.string().min(1).optional(),
    roles: rolesField,
    userType: z.enum(["staff", "customer"]).optional(),
    jobRoles: z.array(z.string().min(1)).optional(),
    jobRoleData: jobRoleDataSchema,
    username: usernameField,
    territories: territoriesSchema,
    schedulable: z.boolean().optional(),
    weeklyHours: weeklyHoursSchema,
    homeLocation: homeLocationSchema,
    serviceCities: serviceCitiesSchema,
    scheduleExceptions: z.array(scheduleExceptionSchema).optional(),
  })
  .refine((data) => Boolean(data.role || (data.roles && data.roles.length > 0)), {
    message: "Role is required",
    path: ["role"],
  });

export const updateUserSchema = z.object({
  email: z.string().email("Invalid email address").optional(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).optional(),
  roles: rolesField,
  userType: z.enum(["staff", "customer"]).optional(),
  jobRoles: z.array(z.string().min(1)).optional(),
  jobRoleData: jobRoleDataSchema,
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
  serviceCities: serviceCitiesSchema,
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
