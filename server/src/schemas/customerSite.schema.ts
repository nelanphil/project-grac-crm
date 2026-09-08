import { z } from "zod";

export const propertyTypeSchema = z.enum(["residential", "commercial"]);

export const createCustomerAddressSchema = z.object({
  label: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  zip: z.string().trim().max(20).optional().default(""),
  county: z.string().trim().max(120).optional().default(""),
  countyManual: z.boolean().optional().default(false),
  isPrimary: z.boolean().optional(),
  propertyType: propertyTypeSchema.optional().default("residential"),
});

export const updateCustomerAddressSchema = z.object({
  label: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(20).optional(),
  county: z.string().trim().max(120).optional(),
  countyManual: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  propertyType: propertyTypeSchema.optional(),
});

export const createEquipmentSchema = z.object({
  addressRef: z.string().min(1, "addressRef is required"),
  generatorModel: z.string().trim().max(200).optional().default(""),
  serial: z.string().trim().max(120).optional().default(""),
  atsSerial: z.string().trim().max(120).optional().default(""),
  lastSvc: z.union([z.string(), z.null()]).optional(),
  exday: z.string().trim().max(40).optional().default(""),
  extime: z.string().trim().max(40).optional().default(""),
});

export const updateEquipmentSchema = z.object({
  addressRef: z.string().min(1).optional(),
  generatorModel: z.string().trim().max(200).optional(),
  serial: z.string().trim().max(120).optional(),
  atsSerial: z.string().trim().max(120).optional(),
  lastSvc: z.union([z.string(), z.null()]).optional(),
  exday: z.string().trim().max(40).optional(),
  extime: z.string().trim().max(40).optional(),
});

export const createCustomerContactSchema = z.object({
  first: z.string().trim().max(120).optional().default(""),
  last: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid email address",
    }),
  label: z.string().trim().max(120).optional().default(""),
  isPrimary: z.boolean().optional(),
});

export const updateCustomerContactSchema = z.object({
  first: z.string().trim().max(120).optional(),
  last: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => v === undefined || v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid email address",
    }),
  label: z.string().trim().max(120).optional(),
  isPrimary: z.boolean().optional(),
});

export const portalUpdateAddressSchema = z.object({
  label: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(20).optional(),
  isPrimary: z.boolean().optional(),
});

export const portalUpdateContactSchema = z.object({
  first: z.string().trim().max(120).optional(),
  last: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => v === undefined || v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid email address",
    }),
  label: z.string().trim().max(120).optional(),
  isPrimary: z.boolean().optional(),
});

export const portalCreateAddressSchema = z.object({
  label: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().min(1, "Street address is required").max(300),
  city: z.string().trim().max(120).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  zip: z.string().trim().max(20).optional().default(""),
  isPrimary: z.boolean().optional(),
});

export const portalCreateContactSchema = z.object({
  first: z.string().trim().min(1, "First name is required").max(120),
  last: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid email address",
    }),
  label: z.string().trim().max(120).optional().default(""),
  isPrimary: z.boolean().optional(),
});

export const mergeCustomersSchema = z.object({
  sourceCustomerId: z.string().min(1, "sourceCustomerId is required"),
  primaryContactId: z.string().min(1).optional(),
});

export type CreateCustomerAddressInput = z.infer<typeof createCustomerAddressSchema>;
export type UpdateCustomerAddressInput = z.infer<typeof updateCustomerAddressSchema>;
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
export type CreateCustomerContactInput = z.infer<typeof createCustomerContactSchema>;
export type UpdateCustomerContactInput = z.infer<typeof updateCustomerContactSchema>;
export type MergeCustomersInput = z.infer<typeof mergeCustomersSchema>;
export type PortalUpdateAddressInput = z.infer<typeof portalUpdateAddressSchema>;
export type PortalUpdateContactInput = z.infer<typeof portalUpdateContactSchema>;
export type PortalCreateAddressInput = z.infer<typeof portalCreateAddressSchema>;
export type PortalCreateContactInput = z.infer<typeof portalCreateContactSchema>;
