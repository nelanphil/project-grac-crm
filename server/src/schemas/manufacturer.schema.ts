import { z } from "zod";

export const createManufacturerSchema = z.object({
  name: z.string().trim().toUpperCase().min(1).max(120),
});

export type CreateManufacturerInput = z.infer<typeof createManufacturerSchema>;
