import { z } from "zod";
import {
  PAYMENT_ENVIRONMENTS,
  PAYMENT_PROVIDERS,
} from "../models/mongo/PaymentProviderAccount";

const providerSchema = z.enum(PAYMENT_PROVIDERS);
const environmentSchema = z.enum(PAYMENT_ENVIRONMENTS);

export const createPaymentProviderAccountSchema = z
  .object({
    provider: providerSchema,
    friendlyName: z.string().trim().min(1, "Account name is required").max(120),
    environment: environmentSchema.default("sandbox"),
    isActive: z.boolean().optional().default(true),
    isDefault: z.boolean().optional().default(false),
    applicationId: z.string().trim().optional(),
    locationId: z.string().trim().optional(),
    publishableKey: z.string().trim().optional(),
    clientId: z.string().trim().optional(),
    accessToken: z.string().trim().optional(),
    webhookSignatureKey: z.string().trim().optional(),
    secretKey: z.string().trim().optional(),
    webhookSecret: z.string().trim().optional(),
    clientSecret: z.string().trim().optional(),
    webhookId: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "square") {
      if (!data.applicationId?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["applicationId"],
          message: "Application ID is required for Square",
        });
      }
      if (!data.locationId?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["locationId"],
          message: "Location ID is required for Square",
        });
      }
      if (!data.accessToken?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["accessToken"],
          message: "Access token is required for Square",
        });
      }
    }
    if (data.provider === "stripe") {
      if (!data.publishableKey?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["publishableKey"],
          message: "Publishable key is required for Stripe",
        });
      }
      if (!data.secretKey?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["secretKey"],
          message: "Secret key is required for Stripe",
        });
      }
    }
    if (data.provider === "paypal") {
      if (!data.clientId?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["clientId"],
          message: "Client ID is required for PayPal",
        });
      }
      if (!data.clientSecret?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["clientSecret"],
          message: "Client secret is required for PayPal",
        });
      }
    }
  });

export const updatePaymentProviderAccountSchema = z.object({
  friendlyName: z.string().trim().min(1).max(120).optional(),
  environment: environmentSchema.optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  applicationId: z.string().trim().optional(),
  locationId: z.string().trim().optional(),
  publishableKey: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
  webhookSignatureKey: z.string().trim().optional(),
  secretKey: z.string().trim().optional(),
  webhookSecret: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
  webhookId: z.string().trim().optional(),
});

export type CreatePaymentProviderAccountInput = z.infer<
  typeof createPaymentProviderAccountSchema
>;
export type UpdatePaymentProviderAccountInput = z.infer<
  typeof updatePaymentProviderAccountSchema
>;
