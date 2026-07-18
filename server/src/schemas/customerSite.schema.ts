import { z } from "zod";

export const createCustomerAddressSchema = z.object({
  label: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  zip: z.string().trim().max(20).optional().default(""),
  isPrimary: z.boolean().optional(),
});

export const updateCustomerAddressSchema = createCustomerAddressSchema.partial();

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
  email: z.string().trim().max(200).optional().default(""),
  label: z.string().trim().max(120).optional().default(""),
  isPrimary: z.boolean().optional(),
});

export const updateCustomerContactSchema = createCustomerContactSchema.partial();

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
