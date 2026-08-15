import { z } from "zod";

const CLOUDINARY_CLOUD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export const cloudinaryCredentialsSchema = z.object({
  cloudName: z
    .string()
    .trim()
    .min(1, "Cloud name is required")
    .max(120)
    .refine((value) => CLOUDINARY_CLOUD_NAME_PATTERN.test(value), {
      message:
        "Cloud name must match your Cloudinary account name exactly, using the same letters, numbers, and hyphens from your dashboard.",
    })
    .optional(),
  apiKey: z.string().trim().min(1, "API key is required").optional(),
  apiSecret: z.string().trim().min(1, "API secret is required").optional(),
  uploadPreset: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
});

export type CloudinaryCredentialsInput = z.infer<
  typeof cloudinaryCredentialsSchema
>;
