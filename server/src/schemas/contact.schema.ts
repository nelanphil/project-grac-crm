import { z } from "zod";
import { personNameSchema } from "./personName";

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .default("")
  .refine((value) => value === "" || z.string().email().safeParse(value).success, {
    message: "Invalid email address",
  });

export const createStandaloneContactSchema = z
  .object({
    first: personNameSchema.optional().default(""),
    last: personNameSchema.optional().default(""),
    phone: z.string().trim().min(1, "Phone number is required").max(40),
    email: optionalEmail,
    customerId: z.string().trim().optional(),
  })
  .refine((value) => value.first.trim() || value.last.trim(), {
    message: "Enter a first or last name",
    path: ["first"],
  });

export const updateStandaloneContactSchema = z.object({
  first: personNameSchema.optional(),
  last: personNameSchema.optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine(
      (value) =>
        value === undefined || value === "" || z.string().email().safeParse(value).success,
      { message: "Invalid email address" },
    ),
  label: z.string().trim().max(120).optional(),
});

export const attachContactSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required"),
});
