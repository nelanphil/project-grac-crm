import { z } from "zod";

export const createEstimateLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  country: z.string().min(1, "Country is required"),
  addressLine1: z.string().min(1, "Address is required"),
  addressLine2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zipCode: z.string().min(1, "Zip code is required"),
  phone: z.string().min(1, "Phone number is required"),
  smsConsent: z.boolean(),
  homeType: z.enum(["single_family", "other"], {
    message: "Home type is required",
  }),
  interestedInFinancing: z.boolean(),
  marketingConsent: z.boolean(),
  source: z.string().optional(),
});

export type CreateEstimateLeadInput = z.infer<typeof createEstimateLeadSchema>;
