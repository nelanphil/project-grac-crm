export type LeadStatus = "new" | "contacted" | "qualified" | "lost" | "won";

export interface LeadListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  status: LeadStatus;
  source: string;
  customerRef: string | null;
  matchedExisting: boolean;
  createdAt: string;
}
