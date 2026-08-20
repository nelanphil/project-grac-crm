import { z } from "zod";
import { saveSquareOAuthAppSchema } from "./paymentProviderAccount.schema";

export const paymentPlatformProviderParamSchema = z.enum([
  "square",
  "stripe",
  "paypal",
]);

export type PaymentPlatformProviderParam = z.infer<
  typeof paymentPlatformProviderParamSchema
>;

export const saveStripePlatformAppSchema = z.object({
  productionPublishableKey: z.string().trim().optional(),
  productionSecretKey: z.string().trim().optional(),
  productionClientId: z.string().trim().optional(),
  sandboxPublishableKey: z.string().trim().optional(),
  sandboxSecretKey: z.string().trim().optional(),
  sandboxClientId: z.string().trim().optional(),
  clearProductionSecretKey: z.boolean().optional(),
  clearSandboxSecretKey: z.boolean().optional(),
});

export const savePayPalPlatformAppSchema = z.object({
  productionClientId: z.string().trim().optional(),
  productionClientSecret: z.string().trim().optional(),
  sandboxClientId: z.string().trim().optional(),
  sandboxClientSecret: z.string().trim().optional(),
  clearProductionClientSecret: z.boolean().optional(),
  clearSandboxClientSecret: z.boolean().optional(),
});

export { saveSquareOAuthAppSchema };

export type SaveStripePlatformAppInput = z.infer<
  typeof saveStripePlatformAppSchema
>;
export type SavePayPalPlatformAppInput = z.infer<
  typeof savePayPalPlatformAppSchema
>;
