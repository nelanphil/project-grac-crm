import { z } from "zod";

export const saveTaxSettingsSchema = z.object({
  ratePercent: z.number().min(0).max(100),
});

export type SaveTaxSettingsInput = z.infer<typeof saveTaxSettingsSchema>;
