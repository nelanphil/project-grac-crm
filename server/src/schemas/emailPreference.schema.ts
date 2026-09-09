import { z } from "zod";

export const emailPreferenceTokenQuerySchema = z.object({
  token: z.string().trim().min(1).max(2000),
});

export const updatePublicEmailPreferenceSchema = z
  .object({
    token: z.string().trim().min(1).max(2000),
    generalNotifications: z.boolean().optional(),
    billingAlerts: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.generalNotifications !== undefined ||
      data.billingAlerts !== undefined,
    {
      message: "At least one preference is required",
      path: ["generalNotifications"],
    },
  );
