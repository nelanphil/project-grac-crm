export interface EstimateFormData {
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  smsConsent: boolean;
  homeType: "" | "single_family" | "other";
  interestedInFinancing: boolean | null;
  marketingConsent: boolean;
  source?: string;
}

export const INITIAL_ESTIMATE_FORM: EstimateFormData = {
  firstName: "",
  lastName: "",
  email: "",
  country: "United States",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zipCode: "",
  phone: "",
  smsConsent: false,
  homeType: "",
  interestedInFinancing: null,
  marketingConsent: false,
};

export type EstimatePayload = Omit<
  EstimateFormData,
  "homeType" | "interestedInFinancing" | "addressLine2"
> & {
  homeType: "single_family" | "other";
  interestedInFinancing: boolean;
  addressLine2?: string;
};
