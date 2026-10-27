import { z } from "zod";
import { DEFAULT_GROK_MODEL } from "../models/mongo/XaiCredentials";

export const xaiCredentialsSchema = z.object({
  apiKey: z.string().trim().optional().default(""),
  model: z.string().trim().max(120).optional().default(DEFAULT_GROK_MODEL),
  isActive: z.boolean().optional().default(true),
});
