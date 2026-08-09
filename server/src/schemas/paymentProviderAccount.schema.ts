import { z } from "zod";
import {
  PAYMENT_AUTH_METHODS,
  PAYMENT_ENVIRONMENTS,
  PAYMENT_PROVIDERS,
} from "../models/mongo/PaymentProviderAccount";

const providerSchema = z.enum(PAYMENT_PROVIDERS);
const environmentSchema = z.enum(PAYMENT_ENVIRONMENTS);
const authMethodSchema = z.enum(PAYMENT_AUTH_METHODS);
const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid user id")
  .nullable()
  .optional();

export const createPaymentProviderAccountSchema = z
  .object({
    provider: providerSchema,
    friendlyName: z.string().trim().min(1, "Account name is required").max(120),
    environment: environmentSchema.default("sandbox"),
    isActive: z.boolean().optional().default(true),
    isDefault: z.boolean().optional().default(false),
    /** Null/omit = global fallback account. */
    ownerUserId: objectIdSchema,
    authMethod: authMethodSchema.optional().default("manual"),
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
    if (data.authMethod === "oauth") {
      ctx.addIssue({
        code: "custom",
        path: ["authMethod"],
        message: "OAuth accounts must be created via the Square Connect flow",
      });
      return;
    }
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
  /** Null clears assignment (global). Omit to leave unchanged. */
  ownerUserId: objectIdSchema,
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

export const startSquareOAuthSchema = z.object({
  environment: environmentSchema.default("sandbox"),
  /** Null/omit = connect as global fallback. Owners are forced to themselves. */
  ownerUserId: objectIdSchema,
  friendlyName: z.string().trim().min(1).max(120).optional(),
});

const squareProductionOAuthSecretSchema = z
  .string()
  .trim()
  .refine(
    (value) => !value || /^sq0csp-/i.test(value),
    "Production OAuth Application Secret must come from Square → OAuth and usually starts with sq0csp-. Access tokens (EAAA…) and Credentials-page secrets are not valid here.",
  );

const squareSandboxOAuthSecretSchema = z
  .string()
  .trim()
  .refine(
    (value) => !value || /^sandbox-sq0csb-/i.test(value),
    "Sandbox OAuth Application Secret must come from Square → OAuth (Sandbox) and usually starts with sandbox-sq0csb-. Access tokens are not valid here.",
  );

export const saveSquareOAuthAppSchema = z.object({
  productionApplicationId: z.string().trim().optional(),
  productionApplicationSecret: squareProductionOAuthSecretSchema.optional(),
  sandboxApplicationId: z.string().trim().optional(),
  sandboxApplicationSecret: squareSandboxOAuthSecretSchema.optional(),
  /** When true, clear the matching secret if the secret field is blank. */
  clearProductionApplicationSecret: z.boolean().optional(),
  clearSandboxApplicationSecret: z.boolean().optional(),
});

export type CreatePaymentProviderAccountInput = z.infer<
  typeof createPaymentProviderAccountSchema
>;
export type UpdatePaymentProviderAccountInput = z.infer<
  typeof updatePaymentProviderAccountSchema
>;
export type StartSquareOAuthInput = z.infer<typeof startSquareOAuthSchema>;
export type SaveSquareOAuthAppInput = z.infer<typeof saveSquareOAuthAppSchema>;
