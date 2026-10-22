import { z } from "zod";
import { toProperCase } from "../utils/formatName";

/** Trimmed person name stored in title case. */
export const personNameSchema = z
  .string()
  .trim()
  .max(120)
  .transform(toProperCase);

/** Required person name stored in title case. */
export const requiredPersonNameSchema = z
  .string()
  .trim()
  .min(1, "First name is required")
  .max(120)
  .transform(toProperCase);
