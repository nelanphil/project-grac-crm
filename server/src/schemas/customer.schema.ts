import { z } from "zod";
import { propertyTypeSchema } from "./customerSite.schema";

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .default("")
  .refine((v) => v === "" || z.string().email().safeParse(v).success, {
    message: "Invalid email address",
  });

export const createCustomerContactNestedSchema = z.object({
  first: z.string().trim().max(120).optional().default(""),
  last: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: optionalEmail,
  label: z.string().trim().max(120).optional().default(""),
  isPrimary: z.boolean().optional(),
});

export const createCustomerEquipmentNestedSchema = z.object({
  generatorModel: z.string().trim().max(200).optional().default(""),
  serial: z.string().trim().max(120).optional().default(""),
  atsSerial: z.string().trim().max(120).optional().default(""),
  lastSvc: z.union([z.string(), z.null()]).optional(),
  exday: z.string().trim().max(40).optional().default(""),
  extime: z.string().trim().max(40).optional().default(""),
});

export const createCustomerAddressNestedSchema = z.object({
  label: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  zip: z.string().trim().max(20).optional().default(""),
  county: z.string().trim().max(120).optional().default(""),
  countyManual: z.boolean().optional().default(false),
  isPrimary: z.boolean().optional(),
  propertyType: propertyTypeSchema.optional().default("residential"),
  equipment: z.array(createCustomerEquipmentNestedSchema).optional().default([]),
});

export const createCustomerSchema = z.object({
  accountName: z.string().trim().max(200).optional().default(""),
  contacts: z.array(createCustomerContactNestedSchema).min(1, "At least one contact is required"),
  addresses: z.array(createCustomerAddressNestedSchema).optional().default([]),
});

export const updateCustomerSchema = z.object({
  accountName: z.string().trim().max(200),
});

export const checkCustomerDuplicatesSchema = z.object({
  excludeId: z.string().trim().max(40).optional(),
  accountName: z.string().trim().max(200).optional().default(""),
  contacts: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        phone: z.string().trim().max(40).optional().default(""),
        email: z.string().trim().max(200).optional().default(""),
        isPrimary: z.boolean().optional().default(false),
      }),
    )
    .max(20)
    .optional()
    .default([]),
  addresses: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        address: z.string().trim().max(300).optional().default(""),
        city: z.string().trim().max(120).optional().default(""),
        state: z.string().trim().max(40).optional().default(""),
        zip: z.string().trim().max(20).optional().default(""),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CheckCustomerDuplicatesInput = z.infer<
  typeof checkCustomerDuplicatesSchema
>;
export type CreateCustomerContactNested = z.infer<
  typeof createCustomerContactNestedSchema
>;
export type CreateCustomerAddressNested = z.infer<
  typeof createCustomerAddressNestedSchema
>;
