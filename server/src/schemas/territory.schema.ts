import { z } from "zod";
import { isFloridaCounty } from "../constants/floridaCounties";

export const updateTerritoriesSchema = z
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
  });

export type UpdateTerritoriesInput = z.infer<typeof updateTerritoriesSchema>;
