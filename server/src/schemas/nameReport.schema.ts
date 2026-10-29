import { z } from "zod";
import { customerReputationSchema } from "./customer.schema";
import { personNameSchema } from "./personName";

export const updateCustomerNameReportSchema = z
  .object({
    accountName: z.string().trim().max(200).optional(),
    first: personNameSchema.optional(),
    last: personNameSchema.optional(),
    reputation: customerReputationSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.accountName !== undefined ||
      value.first !== undefined ||
      value.last !== undefined ||
      value.reputation !== undefined,
    { message: "No changes to save" },
  );

export const updateContactNameReportSchema = z
  .object({
    first: personNameSchema.optional(),
    last: personNameSchema.optional(),
  })
  .refine(
    (value) => value.first !== undefined || value.last !== undefined,
    { message: "No changes to save" },
  );
