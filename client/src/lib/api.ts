import type { EmailChrome } from "@/lib/emailChrome";
import type { EstimatePayload } from "./estimate-types";
import type { LeadListItem, LeadStatus } from "./lead-types";
import type { AuthUser, NavOrder } from "@/store/useAuthStore";
import type {
  ContractProductDiscountOverride,
  ProductDiscounts,
  TicketContractDiscount,
} from "./productDiscounts";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function submitLead(
  data: EstimatePayload,
): Promise<{ id: string; message: string }> {
  const res = await fetch(`${API_URL}/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      body.message ?? "Something went wrong. Please try again.",
      res.status,
      body.errors,
    );
  }

  return body;
}

export interface ContactFormPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  message: string;
  website?: string;
  recaptchaToken?: string;
}

export async function submitContactForm(
  data: ContactFormPayload,
): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      body.message ?? "Something went wrong. Please try again.",
      res.status,
      body.errors,
    );
  }

  return body;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface GetLeadsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: LeadStatus;
}

export interface LeadsResponse {
  leads: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getLeads(
  token: string,
  options?: GetLeadsParams,
): Promise<LeadsResponse> {
  const params = new URLSearchParams();
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined)
    params.set("pageSize", String(options.pageSize));
  if (options?.search) params.set("search", options.search);
  if (options?.status) params.set("status", options.status);
  const qs = params.toString();
  return authRequest<LeadsResponse>(`/leads${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateLeadStatus(
  token: string,
  id: string,
  status: LeadStatus,
): Promise<{ lead: LeadListItem }> {
  return authRequest<{ lead: LeadListItem }>(`/leads/${id}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
}

export async function convertLead(
  token: string,
  id: string,
): Promise<{ matchedExisting: boolean; customerId: string }> {
  return authRequest<{ matchedExisting: boolean; customerId: string }>(
    `/leads/${id}/convert`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function deleteLead(
  token: string,
  id: string,
): Promise<{ message: string; lead: { _id: string; deletedAt: string } }> {
  return authRequest<{
    message: string;
    lead: { _id: string; deletedAt: string };
  }>(`/leads/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface RegisterResponse {
  message: string;
  user: AuthUser;
}

async function authRequest<T>(
  endpoint: string,
  options: RequestInit,
): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: isFormData
        ? { ...(options.headers ?? {}) }
        : {
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
          },
    });
  } catch {
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      body.message ?? "Something went wrong. Please try again.",
      res.status,
      body.errors,
    );
  }

  return body as T;
}

export async function authLogin(
  identifier: string,
  password: string,
): Promise<LoginResponse> {
  return authRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

export async function authRegister(data: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  acceptTerms: true;
  acceptPrivacy: true;
  smsOptIn?: boolean;
}): Promise<RegisterResponse> {
  return authRequest<RegisterResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function authAcceptLegalConsent(
  token: string,
  data: {
    acceptTerms: true;
    acceptPrivacy: true;
    smsOptIn?: boolean;
    phone?: string;
  },
): Promise<{ user: AuthUser }> {
  return authRequest<{ user: AuthUser }>("/auth/legal-consent", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function authGetMe(token: string): Promise<{ user: AuthUser }> {
  return authRequest<{ user: AuthUser }>("/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateProfile(
  token: string,
  data: {
    first_name?: string;
    last_name?: string;
    email?: string;
    username?: string | null;
  },
): Promise<{ user: AuthUser }> {
  return authRequest<{ user: AuthUser }>("/auth/me", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateNavOrder(
  token: string,
  navOrder: NavOrder,
): Promise<{ navOrder: NavOrder }> {
  return authRequest<{ navOrder: NavOrder }>("/auth/me/nav-order", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(navOrder),
  });
}

export interface UsernameCheckResult {
  valid: boolean;
  message?: string;
  username: string | null;
  usernameNumber: number | null;
  isShared: boolean;
  signInAs: string | null;
}

export async function checkUsernameAvailability(
  token: string,
  username: string,
): Promise<UsernameCheckResult> {
  const q = encodeURIComponent(username);
  return authRequest<UsernameCheckResult>(
    `/auth/username-check?username=${q}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function updatePassword(
  token: string,
  data: { current_password: string; new_password: string },
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/auth/me/password", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function authForgotPassword(
  email: string,
): Promise<{ message: string; devResetUrl?: string; mailError?: string }> {
  return authRequest<{
    message: string;
    devResetUrl?: string;
    mailError?: string;
  }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function authResetPassword(
  token: string,
  password: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export interface UserTerritories {
  counties: string[];
  zips: string[];
}

export interface UserHomeLocation {
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
}

export interface WeeklyDayHours {
  enabled: boolean;
  start: string;
  end: string;
}

export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export type UserWeeklyHours = Record<WeekdayKey, WeeklyDayHours>;

export interface ScheduleException {
  date: string;
  type: "off" | "custom";
  start?: string;
  end?: string;
  note?: string;
}

export interface UserListItem {
  _id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AuthUser["role"];
  username: string | null;
  usernameNumber: number | null;
  territories: UserTerritories;
  schedulable: boolean;
  homeLocation: UserHomeLocation;
  weeklyHours: UserWeeklyHours;
  scheduleExceptions: ScheduleException[];
  createdAt: string;
  updatedAt?: string;
}

export async function getUsers(
  token: string,
): Promise<{ users: UserListItem[] }> {
  return authRequest<{ users: UserListItem[] }>("/users", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createUser(
  token: string,
  data: {
    email: string;
    password?: string;
    first_name: string;
    last_name: string;
    role: string;
    username?: string | null;
    territories?: UserTerritories;
    schedulable?: boolean;
    weeklyHours?: UserWeeklyHours;
    homeLocation?: UserHomeLocation;
    scheduleExceptions?: ScheduleException[];
  },
): Promise<{ user: UserListItem; temporaryPassword?: string }> {
  return authRequest<{ user: UserListItem; temporaryPassword?: string }>(
    "/users",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updateUser(
  token: string,
  id: string,
  data: {
    email?: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    username?: string | null;
    password?: string;
    territories?: UserTerritories;
    schedulable?: boolean;
    weeklyHours?: UserWeeklyHours;
    homeLocation?: UserHomeLocation;
    scheduleExceptions?: ScheduleException[];
  },
): Promise<{ user: UserListItem }> {
  return authRequest<{ user: UserListItem }>(`/users/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteUser(
  token: string,
  id: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/users/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface TerritoryOwner {
  _id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  territories: UserTerritories;
}

export async function getTerritories(
  token: string,
): Promise<{ owners: TerritoryOwner[] }> {
  return authRequest<{ owners: TerritoryOwner[] }>("/territories", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateTerritories(
  token: string,
  userId: string,
  data: UserTerritories,
): Promise<{
  owner: TerritoryOwner;
  reassignment?:
    | { status: "started" }
    | { processed: number; assigned: number };
}> {
  return authRequest<{
    owner: TerritoryOwner;
    reassignment?:
      | { status: "started" }
      | { processed: number; assigned: number };
  }>(`/territories/${userId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function recalculateTerritories(token: string): Promise<{
  message: string;
  reassignment: { processed: number; assigned: number };
}> {
  return authRequest<{
    message: string;
    reassignment: { processed: number; assigned: number };
  }>("/territories/recalculate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}

export interface CustomerAddressSummary {
  _id: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary?: boolean;
  lat?: number | null;
  lng?: number | null;
}

export interface CustomerEquipment {
  _id: string;
  customerRef: string;
  addressRef: string;
  generatorModel: string;
  serial: string;
  atsSerial: string;
  lastSvc: string | null;
  exday: string;
  extime: string;
  createdAt: string;
  updatedAt: string;
}

export type CustomerAddressPropertyType = "residential" | "commercial";

export interface CustomerOwnerSummary {
  _id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface CustomerAddress {
  _id: string;
  customerRef: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  countyManual: boolean;
  isPrimary: boolean;
  propertyType: CustomerAddressPropertyType;
  legacyCustomerId: number | null;
  createdAt: string;
  updatedAt: string;
  equipment: CustomerEquipment[];
}

export interface CustomerContact {
  _id: string;
  customerRef: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
  userRef: string | null;
  legacyCustomerId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListItem extends CustomerContact {
  customer: {
    _id: string;
    accountName: string;
    first: string;
    last: string;
  };
}

export interface GetContactsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
}

export interface ContactsResponse {
  contacts: ContactListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getContacts(
  token: string,
  options?: GetContactsParams,
): Promise<ContactsResponse> {
  const params = new URLSearchParams();
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined)
    params.set("pageSize", String(options.pageSize));
  if (options?.search) params.set("search", options.search);
  if (options?.sortKey) params.set("sortKey", options.sortKey);
  if (options?.sortDir) params.set("sortDir", options.sortDir);
  const qs = params.toString();
  return authRequest<ContactsResponse>(
    `/customers/contacts${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface CustomerContractBadge {
  _id: string;
  standing: ContractStanding;
  contractType: string | null;
  template: { label: string; badgeIcon: string } | null;
}

export interface CustomerListItem {
  _id: string;
  legacyId: number;
  accountName?: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  ownerUserRef?: string | null;
  owner?: CustomerOwnerSummary | null;
  generatorModel: string;
  lastSvc: string | null;
  deletedAt?: string | null;
  /** Other open customers sharing this phone (from list API). */
  duplicateCount?: number;
  /** Lightweight contract badges for the customer (from list API). */
  contracts?: CustomerContractBadge[];
}

export interface CreateCustomerContactInput {
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  label?: string;
  isPrimary?: boolean;
}

export interface CreateCustomerEquipmentInput {
  generatorModel?: string;
  serial?: string;
  atsSerial?: string;
  lastSvc?: string | null;
  exday?: string;
  extime?: string;
}

export interface CreateCustomerAddressInput {
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  countyManual?: boolean;
  isPrimary?: boolean;
  propertyType?: CustomerAddressPropertyType;
  equipment?: CreateCustomerEquipmentInput[];
}

export interface CreateCustomerInput {
  accountName?: string;
  contacts: CreateCustomerContactInput[];
  addresses?: CreateCustomerAddressInput[];
  /** @deprecated Flat-shape fields — server still accepts them for compat. */
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  propertyType?: CustomerAddressPropertyType;
}

export type CustomerSortKey =
  | "customer"
  | "phone"
  | "street"
  | "city"
  | "state"
  | "zip";
export type CustomerSortDir = "asc" | "desc";

export interface GetCustomersParams {
  deletedOnly?: boolean;
  page?: number;
  pageSize?: number;
  search?: string;
  sortKey?: CustomerSortKey;
  sortDir?: CustomerSortDir;
}

export interface CustomersResponse {
  customers: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getCustomers(
  token: string,
  options?: GetCustomersParams,
): Promise<CustomersResponse> {
  const params = new URLSearchParams();
  if (options?.deletedOnly) params.set("deleted", "1");
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined)
    params.set("pageSize", String(options.pageSize));
  if (options?.search) params.set("search", options.search);
  if (options?.sortKey) params.set("sortKey", options.sortKey);
  if (options?.sortDir) params.set("sortDir", options.sortDir);
  const qs = params.toString();
  return authRequest<CustomersResponse>(`/customers${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createCustomer(
  token: string,
  body: CreateCustomerInput,
): Promise<{ customer: CustomerListItem }> {
  return authRequest<{ customer: CustomerListItem }>("/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function updateCustomer(
  token: string,
  id: string,
  body: { accountName: string },
): Promise<{ customer: CustomerListItem }> {
  return authRequest<{ customer: CustomerListItem }>(`/customers/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function promoteCustomer(
  token: string,
  id: string,
): Promise<{ customer: { _id: string; isTemporary: boolean } }> {
  return authRequest<{ customer: { _id: string; isTemporary: boolean } }>(
    `/customers/${id}/promote`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface ValidatedAddress {
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
}

export interface ValidateCustomerAddressResult {
  valid: boolean;
  matchedAddress?: string;
  address?: ValidatedAddress;
  coordinates?: { lng: number; lat: number } | null;
  message?: string;
}

export async function validateCustomerAddress(
  token: string,
  body: {
    address: string;
    city?: string;
    state?: string;
    zip?: string;
  },
): Promise<ValidateCustomerAddressResult> {
  return authRequest<ValidateCustomerAddressResult>(
    "/customers/validate-address",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );
}

export async function softDeleteCustomer(
  token: string,
  id: string,
): Promise<{ message: string; customer: { _id: string; deletedAt: string } }> {
  return authRequest<{
    message: string;
    customer: { _id: string; deletedAt: string };
  }>(`/customers/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function restoreCustomer(
  token: string,
  id: string,
): Promise<{
  message: string;
  customer: { _id: string; deletedAt: null };
}> {
  return authRequest<{
    message: string;
    customer: { _id: string; deletedAt: null };
  }>(`/customers/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface CustomerDetail {
  _id: string;
  legacyId: number;
  accountName?: string;
  first: string;
  last: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  ownerUserRef?: string | null;
  owner?: CustomerOwnerSummary | null;
  phone: string;
  email: string;
  atsSerial: string;
  serial: string;
  generatorModel: string;
  lastSvc: string | null;
  exday: string;
  extime: string;
  mergedIntoRef?: string | null;
  isTemporary?: boolean;
  addresses: CustomerAddress[];
  contacts: CustomerContact[];
}

export async function getCustomer(
  token: string,
  id: string,
): Promise<{ customer: CustomerDetail }> {
  return authRequest<{ customer: CustomerDetail }>(`/customers/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface CustomerDuplicateMatch {
  _id: string;
  legacyId: number;
  accountName?: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export async function getCustomerDuplicates(
  token: string,
  phone: string,
  excludeId?: string,
): Promise<{ phone: string; customers: CustomerDuplicateMatch[] }> {
  const params = new URLSearchParams({ phone });
  if (excludeId) params.set("excludeId", excludeId);
  return authRequest<{ phone: string; customers: CustomerDuplicateMatch[] }>(
    `/customers/duplicates?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface MergePreviewContract {
  _id: string;
  description: string;
  contractType: string | null;
  templateLabel: string | null;
  templateSlug: string | null;
  renewalDueDate: string | null;
  standing: ContractStanding;
  equipmentLabel: string | null;
}

export interface MergePreviewAllocation {
  origin: "survivor" | "source";
  _id: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
  equipment: Array<{
    _id: string;
    generatorModel: string;
    serial: string;
    atsSerial: string;
  }>;
  workOrderCount: number;
  contracts: MergePreviewContract[];
}

export interface MergePreviewUnassignedSide {
  workOrderCount: number;
  contracts: MergePreviewContract[];
}

export interface MergePreviewContact extends CustomerContact {
  origin: "survivor" | "source";
}

export interface MergePreview {
  survivor: {
    _id: string;
    legacyId: number;
    accountName?: string;
    first: string;
    last: string;
    phone: string;
    email?: string;
  };
  source: {
    _id: string;
    legacyId: number;
    accountName?: string;
    first: string;
    last: string;
    phone: string;
    email?: string;
  };
  contacts: MergePreviewContact[];
  defaultPrimaryContactId: string | null;
  allocation: MergePreviewAllocation[];
  unassigned: {
    survivor: MergePreviewUnassignedSide;
    source: MergePreviewUnassignedSide;
  };
  totals: {
    addresses: number;
    equipment: number;
    workOrders: number;
    contracts: number;
    notes: number;
    contacts: number;
  };
  contractsFromBothSides: boolean;
}

export async function getMergePreview(
  token: string,
  survivorId: string,
  sourceCustomerId: string,
): Promise<MergePreview> {
  const params = new URLSearchParams({ sourceCustomerId });
  return authRequest<MergePreview>(
    `/customers/${survivorId}/merge-preview?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function mergeCustomers(
  token: string,
  survivorId: string,
  sourceCustomerId: string,
  options?: { primaryContactId?: string },
): Promise<{ customer: CustomerDetail; mergedSourceId: string }> {
  return authRequest<{ customer: CustomerDetail; mergedSourceId: string }>(
    `/customers/${survivorId}/merge`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sourceCustomerId,
        ...(options?.primaryContactId
          ? { primaryContactId: options.primaryContactId }
          : {}),
      }),
    },
  );
}

export async function getCustomerContacts(
  token: string,
  customerId: string,
): Promise<{ contacts: CustomerContact[] }> {
  return authRequest<{ contacts: CustomerContact[] }>(
    `/customers/${customerId}/contacts`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createCustomerContact(
  token: string,
  customerId: string,
  data: {
    first?: string;
    last?: string;
    phone?: string;
    email?: string;
    label?: string;
    isPrimary?: boolean;
  },
): Promise<{ contact: CustomerContact }> {
  return authRequest<{ contact: CustomerContact }>(
    `/customers/${customerId}/contacts`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updateCustomerContact(
  token: string,
  customerId: string,
  contactId: string,
  data: {
    first?: string;
    last?: string;
    phone?: string;
    email?: string;
    label?: string;
    isPrimary?: boolean;
  },
): Promise<{ contact: CustomerContact }> {
  return authRequest<{ contact: CustomerContact }>(
    `/customers/${customerId}/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteCustomerContact(
  token: string,
  customerId: string,
  contactId: string,
): Promise<void> {
  await authRequest<void>(`/customers/${customerId}/contacts/${contactId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createCustomerAddress(
  token: string,
  customerId: string,
  data: {
    label?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    countyManual?: boolean;
    isPrimary?: boolean;
    propertyType?: CustomerAddressPropertyType;
  },
): Promise<{ address: CustomerAddress }> {
  return authRequest<{ address: CustomerAddress }>(
    `/customers/${customerId}/addresses`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updateCustomerAddress(
  token: string,
  customerId: string,
  addressId: string,
  data: {
    label?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    countyManual?: boolean;
    isPrimary?: boolean;
    propertyType?: CustomerAddressPropertyType;
  },
): Promise<{ address: CustomerAddress }> {
  return authRequest<{ address: CustomerAddress }>(
    `/customers/${customerId}/addresses/${addressId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function createCustomerEquipment(
  token: string,
  customerId: string,
  data: {
    addressRef: string;
    generatorModel?: string;
    serial?: string;
    atsSerial?: string;
    lastSvc?: string | null;
    exday?: string;
    extime?: string;
  },
): Promise<{ equipment: CustomerEquipment }> {
  return authRequest<{ equipment: CustomerEquipment }>(
    `/customers/${customerId}/equipment`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export interface SerialConflict {
  field: "serial" | "atsSerial";
  value: string;
  equipmentId: string;
  addressId: string | null;
  addressLabel: string | null;
  customerId: string;
  customerName: string | null;
}

export async function checkEquipmentSerial(
  token: string,
  customerId: string,
  params: { serial?: string; atsSerial?: string; excludeEquipmentId?: string },
): Promise<{ blocking: SerialConflict[]; warnings: SerialConflict[] }> {
  const query = new URLSearchParams();
  if (params.serial) query.set("serial", params.serial);
  if (params.atsSerial) query.set("atsSerial", params.atsSerial);
  if (params.excludeEquipmentId)
    query.set("excludeEquipmentId", params.excludeEquipmentId);
  return authRequest<{
    blocking: SerialConflict[];
    warnings: SerialConflict[];
  }>(`/customers/${customerId}/equipment/check-serial?${query.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface CustomerNoteAuthor {
  first_name: string;
  last_name: string;
}

export interface CustomerNote {
  _id: string;
  customerRef: string;
  authorId: string;
  author: CustomerNoteAuthor;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export async function getCustomerNotes(
  token: string,
  customerId: string,
): Promise<{ notes: CustomerNote[] }> {
  return authRequest<{ notes: CustomerNote[] }>(
    `/customers/${customerId}/notes`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createCustomerNote(
  token: string,
  customerId: string,
  content: string,
): Promise<{ note: CustomerNote }> {
  return authRequest<{ note: CustomerNote }>(`/customers/${customerId}/notes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
}

export async function updateCustomerNote(
  token: string,
  customerId: string,
  noteId: string,
  content: string,
): Promise<{ note: CustomerNote }> {
  return authRequest<{ note: CustomerNote }>(
    `/customers/${customerId}/notes/${noteId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content }),
    },
  );
}

export async function deleteCustomerNote(
  token: string,
  customerId: string,
  noteId: string,
): Promise<void> {
  await authRequest<Record<string, never>>(
    `/customers/${customerId}/notes/${noteId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export type TicketLineType = "product" | "note";
export type ProductKind = "part" | "labor";

export interface WorkOrderPart {
  productRef?: string | null;
  lineType?: TicketLineType;
  kind?: ProductKind;
  partNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
  listPrice?: number;
  priceOverridden?: boolean;
  amount: number;
}

export interface WorkOrderAssignee {
  _id: string;
  first_name: string;
  last_name: string;
}

export interface WorkOrderListItem {
  _id: string;
  legacyId?: number;
  number?: string;
  date: string | null;
  descPerform: string;
  descPerformed: string;
  tech: string;
  total: number;
  totalParts?: number;
  totalLabor?: number;
  miscExp?: number;
  subtotal?: number;
  shipping?: number;
  paid: boolean;
  completed: boolean;
  laborHours?: number;
  runHours?: number;
  parts?: WorkOrderPart[];
  customerName?: string | null;
  customerAddress?: string;
  customerCity?: string;
  customerZip?: string;
  customerPhone?: string;
  customerEmail?: string;
  workPhone?: string;
  serialNumber?: string;
  generatorModel?: string;
  exerciseDay?: string;
  exerciseTime?: string;
  signatureDataUrl?: string;
  signedAt?: string | null;
  signedByName?: string;
  laborOverridden?: boolean;
  addressRef?: string | null;
  equipmentRef?: string | null;
  estimateRef?: string | null;
  contractRef?: string | null;
  contractDiscount?: TicketContractDiscount | null;
  address?: CustomerAddressSummary | null;
  assignedUserRef?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  estimatedMinutes?: number;
  appointmentCanceledAt?: string | null;
  appointmentCanceledBy?: string | null;
  customerRef?: string | null;
  customerId?: number;
  assignee?: WorkOrderAssignee | null;
  warnings?: string[];
}

export type ServiceTicketPayload = {
  customerId: number;
  addressRef?: string | null;
  equipmentRef?: string | null;
  estimateRef?: string | null;
  descPerform?: string;
  descPerformed?: string;
  date?: string | null;
  tech?: string;
  paid?: boolean;
  completed?: boolean;
  certify?: boolean;
  runHours?: number;
  laborHours?: number;
  totalLabor?: number;
  laborOverridden?: boolean;
  miscExp?: number;
  shipping?: number;
  parts?: WorkOrderPart[];
  customerName?: string;
  customerAddress?: string;
  customerCity?: string;
  customerZip?: string;
  customerPhone?: string;
  customerEmail?: string;
  workPhone?: string;
  serialNumber?: string;
  generatorModel?: string;
  exerciseDay?: string;
  exerciseTime?: string;
  signatureDataUrl?: string | null;
  signedByName?: string;
  status?: "draft" | "sent" | "accepted" | "declined" | "converted";
  contractRef?: string | null;
  contractDiscount?: TicketContractDiscount | null;
};

export async function getWorkOrders(
  token: string,
  opts?: {
    page?: number;
    pageSize?: number;
    search?: string;
    paid?: boolean;
    completed?: boolean;
    from?: string;
    to?: string;
    customerId?: number;
  },
): Promise<{
  workOrders: WorkOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (opts?.page != null) params.set("page", String(opts.page));
  if (opts?.pageSize != null) params.set("pageSize", String(opts.pageSize));
  if (opts?.search) params.set("search", opts.search);
  if (opts?.paid === true) params.set("paid", "1");
  if (opts?.paid === false) params.set("paid", "0");
  if (opts?.completed === true) params.set("completed", "1");
  if (opts?.completed === false) params.set("completed", "0");
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  if (opts?.customerId != null) params.set("customerId", String(opts.customerId));
  return authRequest<{
    workOrders: WorkOrderListItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/work-orders?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getWorkOrder(
  token: string,
  id: string,
): Promise<WorkOrderListItem> {
  return authRequest<WorkOrderListItem>(`/work-orders/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createWorkOrder(
  token: string,
  data: ServiceTicketPayload,
): Promise<WorkOrderListItem> {
  return authRequest<WorkOrderListItem>("/work-orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteWorkOrder(token: string, id: string): Promise<void> {
  await authRequest<void>(`/work-orders/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getWorkOrdersForCustomer(
  token: string,
  legacyId: number,
  addressId?: string,
): Promise<WorkOrderListItem[]> {
  const params = new URLSearchParams({ customerId: String(legacyId) });
  if (addressId) params.set("addressId", addressId);
  return authRequest<WorkOrderListItem[]>(`/work-orders?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getScheduleWorkOrders(
  token: string,
  opts: {
    from: string;
    to: string;
    assignedUserId?: string;
    unscheduled?: boolean;
  },
): Promise<WorkOrderListItem[]> {
  const params = new URLSearchParams({ from: opts.from, to: opts.to });
  if (opts.assignedUserId) params.set("assignedUserId", opts.assignedUserId);
  if (opts.unscheduled) params.set("unscheduled", "1");
  return authRequest<WorkOrderListItem[]>(`/work-orders?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateWorkOrder(
  token: string,
  id: string,
  data: Partial<ServiceTicketPayload> & {
    assignedUserRef?: string | null;
    scheduledStart?: string | null;
    estimatedMinutes?: number;
  },
): Promise<WorkOrderListItem> {
  return authRequest<WorkOrderListItem>(`/work-orders/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export interface ScheduleQueue {
  unscheduled: WorkOrderListItem[];
  today: WorkOrderListItem[];
  upcoming: WorkOrderListItem[];
  pastDue: WorkOrderListItem[];
}

export async function getScheduleQueue(
  token: string,
  opts?: { from?: string; to?: string },
): Promise<ScheduleQueue> {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  const qs = params.toString();
  return authRequest<ScheduleQueue>(
    `/schedule/queue${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function cancelWorkOrderAppointment(
  token: string,
  id: string,
): Promise<WorkOrderListItem> {
  return authRequest<WorkOrderListItem>(
    `/work-orders/${id}/cancel-appointment`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface ScheduleStaffMember {
  _id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  schedulable: boolean;
  homeLocation: UserHomeLocation;
  weeklyHours: UserWeeklyHours;
  scheduleExceptions: ScheduleException[];
}

export async function getScheduleStaff(
  token: string,
  from: string,
  to: string,
): Promise<{ staff: ScheduleStaffMember[]; workOrders: WorkOrderListItem[] }> {
  const params = new URLSearchParams({ from, to });
  return authRequest<{
    staff: ScheduleStaffMember[];
    workOrders: WorkOrderListItem[];
  }>(`/schedule/staff?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface ScheduleSuggestion {
  userId: string;
  first_name: string;
  last_name: string;
  proposedStart: string;
  proposedEnd: string;
  driveMinutes: number;
  remainingMinutes: number;
  existingJobCount: number;
  fits: boolean;
  reason: string;
  driveSource: "google" | "haversine" | "none";
  driveFrom: "previousJob" | "home" | "unknown";
  driveFromLabel: string;
  driveKnown: boolean;
}

export async function suggestScheduleAssignee(
  token: string,
  data: { workOrderId: string; date: string; estimatedMinutes?: number },
): Promise<{
  workOrderId: string;
  date: string;
  estimatedMinutes: number;
  suggestions: ScheduleSuggestion[];
}> {
  return authRequest(`/schedule/suggest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export interface ScheduleRouteStop {
  kind: "home" | "job";
  label: string;
  lat: number | null;
  lng: number | null;
  workOrderId?: string;
  scheduledStart?: string | null;
}

export interface ScheduleRouteLeg {
  durationMinutes: number;
  distanceMeters: number;
  encodedPolyline?: string;
}

export async function getScheduleRoute(
  token: string,
  userId: string,
  date: string,
): Promise<{
  user: ScheduleStaffMember;
  date: string;
  stops: ScheduleRouteStop[];
  route: {
    durationMinutes: number;
    distanceMeters: number;
    encodedPolyline?: string;
    legs: ScheduleRouteLeg[];
    source: "google" | "haversine";
  } | null;
}> {
  const params = new URLSearchParams({ userId, date });
  return authRequest(`/schedule/route?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type ContractStanding = "active" | "due_soon" | "expired";

export interface ContractRenewalEvent {
  _id?: string;
  renewedAt: string;
  durationMonths: number;
  previousDueDate: string;
  newDueDate: string;
  wasLate: boolean;
  notes?: string;
  createdAt?: string;
}

export interface ContractTemplateSummary {
  _id: string;
  label: string;
  slug: string;
  badgeIcon: string;
  cost: number;
  productDiscounts?: ProductDiscounts;
  deletedAt: string | null;
}

export interface ContractEquipmentSummary {
  _id: string;
  addressRef: string;
  generatorModel: string;
  serial: string;
  atsSerial: string;
}

export interface ContractListItem {
  _id: string;
  customerId: number;
  addressRef?: string | null;
  equipmentRef?: string | null;
  templateId?: string | null;
  originalContractDate: string | null;
  contractDate: string | null;
  durationMonths: number;
  renewalDueDate: string | null;
  lastRenewalDate: string | null;
  description: string;
  contractType: string | null;
  standing: ContractStanding;
  inGoodStanding: boolean;
  productDiscounts?: ContractProductDiscountOverride;
  renewals?: ContractRenewalEvent[];
  template?: ContractTemplateSummary | null;
  address?: CustomerAddressSummary | null;
  equipment?: ContractEquipmentSummary | null;
  customer: {
    _id: string;
    accountName?: string;
    first: string;
    last: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    /** Other open customers sharing this phone. */
    duplicateCount?: number;
  } | null;
}

export async function getContracts(
  token: string,
  standing?: ContractStanding | "all",
  opts?: { year?: number; month?: number },
): Promise<{ contracts: ContractListItem[] }> {
  const params = new URLSearchParams();
  if (standing && standing !== "all") params.set("standing", standing);
  if (opts?.year !== undefined) params.set("year", String(opts.year));
  if (opts?.month !== undefined) params.set("month", String(opts.month));
  const qs = params.toString();
  return authRequest<{ contracts: ContractListItem[] }>(
    `/contracts${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getContractsForCustomer(
  token: string,
  legacyId: number,
  addressId?: string,
): Promise<{ contracts: ContractListItem[] }> {
  const params = new URLSearchParams({ customerId: String(legacyId) });
  if (addressId) params.set("addressId", addressId);
  return authRequest<{ contracts: ContractListItem[] }>(
    `/contracts?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getContract(
  token: string,
  id: string,
): Promise<{ contract: ContractListItem }> {
  return authRequest<{ contract: ContractListItem }>(`/contracts/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createContract(
  token: string,
  data: {
    customerId: number;
    contractDate?: string | null;
    description?: string;
    durationMonths?: number;
    templateId?: string | null;
    addressRef?: string | null;
    equipmentRef?: string | null;
  },
): Promise<{ contract: ContractListItem }> {
  return authRequest<{ contract: ContractListItem }>("/contracts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateContract(
  token: string,
  id: string,
  data: {
    contractDate?: string | null;
    originalContractDate?: string | null;
    description?: string;
    durationMonths?: number;
    templateId?: string | null;
    addressRef?: string | null;
    equipmentRef?: string | null;
    productDiscounts?: ContractProductDiscountOverride;
  },
): Promise<{ contract: ContractListItem }> {
  return authRequest<{ contract: ContractListItem }>(`/contracts/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function renewContract(
  token: string,
  id: string,
  data: {
    renewedAt: string;
    durationMonths?: number;
    notes?: string;
    workOrderRef?: string;
  },
): Promise<{ contract: ContractListItem }> {
  return authRequest<{ contract: ContractListItem }>(`/contracts/${id}/renew`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteContract(token: string, id: string): Promise<void> {
  await authRequest<void>(`/contracts/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceSourceType =
  | "contract_renewal"
  | "contract_initial"
  | "work_order";

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "failed";

export interface InvoiceLineItem {
  description: string;
  amountCents: number;
}

export interface InvoiceCustomerSummary {
  name: string;
  accountNumber: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
}

export interface InvoiceServiceAddress {
  label?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface InvoiceItem {
  _id: string;
  number: string;
  customerId: number;
  customerRef: string | null;
  sourceType: InvoiceSourceType;
  contractRef: string | null;
  workOrderRef: string | null;
  templateRef: string | null;
  lineItems: InvoiceLineItem[];
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  dueDate: string | null;
  issuedAt: string;
  paidAt: string | null;
  paymentProvider: "square" | "stripe" | "paypal" | null;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  hasPayLink: boolean;
  payTokenExpiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Present on GET /invoices/:id only. */
  customer?: InvoiceCustomerSummary | null;
  /** Present on GET /invoices/:id only. */
  serviceAddress?: InvoiceServiceAddress | null;
}

export interface CreateInvoiceInput {
  sourceType: InvoiceSourceType;
  contractRef?: string;
  workOrderRef?: string;
  amountCents?: number;
  description?: string;
  dueDate?: string;
}

export async function getInvoices(
  token: string,
  params?: {
    status?: string;
    customerRef?: string;
    contractRef?: string;
    workOrderRef?: string;
  },
): Promise<{ invoices: InvoiceItem[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.customerRef) qs.set("customerRef", params.customerRef);
  if (params?.contractRef) qs.set("contractRef", params.contractRef);
  if (params?.workOrderRef) qs.set("workOrderRef", params.workOrderRef);
  const q = qs.toString();
  return authRequest<{ invoices: InvoiceItem[] }>(
    `/invoices${q ? `?${q}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getInvoice(
  token: string,
  id: string,
): Promise<{ invoice: InvoiceItem }> {
  return authRequest<{ invoice: InvoiceItem }>(`/invoices/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createInvoice(
  token: string,
  data: CreateInvoiceInput,
): Promise<{ invoice: InvoiceItem }> {
  return authRequest<{ invoice: InvoiceItem }>("/invoices", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function startInvoiceCheckout(
  token: string,
  id: string,
): Promise<{ url: string; invoice: InvoiceItem }> {
  return authRequest<{ url: string; invoice: InvoiceItem }>(
    `/invoices/${id}/checkout`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createInvoicePayLink(
  token: string,
  id: string,
): Promise<{ payUrl: string; expiresAt: string; invoice: InvoiceItem }> {
  return authRequest<{
    payUrl: string;
    expiresAt: string;
    invoice: InvoiceItem;
  }>(`/invoices/${id}/pay-link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getInvoiceByPayToken(
  token: string,
): Promise<{
  invoice: InvoiceItem;
  invoices?: InvoiceItem[];
  totalCents?: number;
}> {
  return authRequest<{
    invoice: InvoiceItem;
    invoices?: InvoiceItem[];
    totalCents?: number;
  }>(`/pay/${token}`, {
    method: "GET",
  });
}

export async function startCheckoutByPayToken(
  token: string,
): Promise<{ url: string; invoice: InvoiceItem }> {
  return authRequest<{ url: string; invoice: InvoiceItem }>(
    `/pay/${token}/checkout`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductItem {
  _id: string;
  productCode: string;
  productNumber: string;
  productAltCode: string;
  partNumber: string;
  name: string;
  manufacturer: { _id: string; name: string } | null;
  kind: ProductKind;
  listPrice: number;
  unitPrice: number;
  cost: number;
  strikeThroughPrice: number;
  active: boolean;
  notes: string;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ProductWritePayload = {
  productCode: string;
  productNumber?: string;
  name: string;
  manufacturer?: string;
  kind?: ProductKind;
  listPrice?: number;
  cost?: number;
  strikeThroughPrice?: number;
  active?: boolean;
  notes?: string;
};

export async function getProducts(
  token: string,
  opts?: { search?: string; active?: boolean },
): Promise<{ products: ProductItem[] }> {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.active) params.set("active", "1");
  const qs = params.toString();
  return authRequest<{ products: ProductItem[] }>(
    `/products${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createProduct(
  token: string,
  data: ProductWritePayload,
): Promise<{ product: ProductItem }> {
  return authRequest<{ product: ProductItem }>("/products", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateProduct(
  token: string,
  id: string,
  data: Partial<ProductWritePayload>,
): Promise<{ product: ProductItem }> {
  return authRequest<{ product: ProductItem }>(`/products/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteProduct(token: string, id: string): Promise<void> {
  await authRequest<void>(`/products/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export interface ManufacturerItem {
  _id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export async function getManufacturers(
  token: string,
): Promise<{ manufacturers: ManufacturerItem[] }> {
  return authRequest<{ manufacturers: ManufacturerItem[] }>("/manufacturers", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createManufacturer(
  token: string,
  data: { name: string },
): Promise<{ manufacturer: ManufacturerItem }> {
  return authRequest<{ manufacturer: ManufacturerItem }>("/manufacturers", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export type EstimateStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "converted";

export interface EstimateItem {
  _id: string;
  number: string;
  status: EstimateStatus;
  customerId: number;
  customerRef?: string | null;
  addressRef?: string | null;
  equipmentRef?: string | null;
  workOrderRef?: string | null;
  descPerform: string;
  laborHours: number;
  date: string | null;
  tech: string;
  parts: WorkOrderPart[];
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerZip: string;
  customerPhone: string;
  customerEmail: string;
  workPhone: string;
  serialNumber: string;
  generatorModel: string;
  exerciseDay: string;
  exerciseTime: string;
  totalParts: number;
  totalLabor: number;
  laborOverridden: boolean;
  miscExp: number;
  subtotal: number;
  shipping: number;
  total: number;
  signatureDataUrl?: string;
  signedAt?: string | null;
  signedByName?: string;
  contractRef?: string | null;
  contractDiscount?: TicketContractDiscount | null;
  createdAt: string;
  updatedAt: string;
}

export async function getEstimates(
  token: string,
  opts?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: EstimateStatus;
    customerId?: number;
  },
): Promise<{
  estimates: EstimateItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (opts?.page != null) params.set("page", String(opts.page));
  if (opts?.pageSize != null) params.set("pageSize", String(opts.pageSize));
  if (opts?.search) params.set("search", opts.search);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.customerId != null) params.set("customerId", String(opts.customerId));
  return authRequest<{
    estimates: EstimateItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/estimates?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getEstimate(
  token: string,
  id: string,
): Promise<{ estimate: EstimateItem }> {
  return authRequest<{ estimate: EstimateItem }>(`/estimates/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createEstimate(
  token: string,
  data: ServiceTicketPayload & { status?: EstimateStatus },
): Promise<{ estimate: EstimateItem }> {
  return authRequest<{ estimate: EstimateItem }>("/estimates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateEstimate(
  token: string,
  id: string,
  data: Partial<ServiceTicketPayload> & { status?: EstimateStatus },
): Promise<{ estimate: EstimateItem }> {
  return authRequest<{ estimate: EstimateItem }>(`/estimates/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function convertEstimate(
  token: string,
  id: string,
): Promise<{ estimate: EstimateItem; workOrder: WorkOrderListItem }> {
  return authRequest<{ estimate: EstimateItem; workOrder: WorkOrderListItem }>(
    `/estimates/${id}/convert`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function deleteEstimate(token: string, id: string): Promise<void> {
  await authRequest<void>(`/estimates/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface FinancialsSummary {
  from: string | null;
  to: string | null;
  invoices: {
    count: number;
    invoicedCents: number;
    paidCents: number;
    outstandingCents: number;
    pastDueCents: number;
    openCount: number;
    paidCount: number;
  };
  workOrders: {
    count: number;
    openCount: number;
    completedCount: number;
    unbilledCents: number;
    laborHours: number;
  };
  estimates: {
    count: number;
    byStatus: Record<string, { count: number; cents: number }>;
  };
}

export async function getFinancialsSummary(
  token: string,
  opts?: { from?: string; to?: string },
): Promise<FinancialsSummary> {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  const qs = params.toString();
  return authRequest<FinancialsSummary>(
    `/financials/summary${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function updateUserRole(
  token: string,
  id: string,
  role: AuthUser["role"],
): Promise<{ user: UserListItem }> {
  return authRequest<{ user: UserListItem }>(`/users/${id}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
}

export async function getRolePermissions(
  token: string,
): Promise<{ roles: Record<string, string[]> }> {
  return authRequest<{ roles: Record<string, string[]> }>(
    "/roles/permissions",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface RoleItem {
  _id: string;
  slug: string;
  label: string;
  isSystem: boolean;
  deletedAt: string | null;
  createdAt: string;
}

export async function getRoles(token: string): Promise<{ roles: RoleItem[] }> {
  return authRequest<{ roles: RoleItem[] }>("/roles", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createRole(
  token: string,
  label: string,
): Promise<{ role: RoleItem }> {
  return authRequest<{ role: RoleItem }>("/roles", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label }),
  });
}

export async function updateRoleLabel(
  token: string,
  slug: string,
  label: string,
): Promise<{ role: RoleItem }> {
  return authRequest<{ role: RoleItem }>(`/roles/${slug}/label`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ label }),
  });
}

export async function renameRole(
  token: string,
  slug: string,
  data: { slug: string; label: string },
): Promise<{ role: RoleItem; oldSlug: string }> {
  return authRequest<{ role: RoleItem; oldSlug: string }>(
    `/roles/${slug}/rename`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteRole(
  token: string,
  slug: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/roles/${slug}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateRolePermissions(
  token: string,
  role: string,
  permissions: string[],
): Promise<{ role: string; permissions: string[] }> {
  return authRequest<{ role: string; permissions: string[] }>(
    `/roles/${role}/permissions`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ permissions }),
    },
  );
}

// ---------------------------------------------------------------------------
// Twilio accounts (Control Panel)
// ---------------------------------------------------------------------------

export type TwilioRuntimeEnvironment = "development" | "production";
export type TwilioCredentialPair = "live" | "test";

export interface TwilioAccountItem {
  _id: string;
  accountSid: string;
  friendlyName: string;
  phoneNumbers: string[];
  isActive: boolean;
  sayVoice: string;
  environment: TwilioRuntimeEnvironment;
  credentialsInUse: TwilioCredentialPair;
  hasAuthToken: boolean;
  testAccountSid: string | null;
  hasTestAuthToken: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TwilioAccountInput {
  accountSid: string;
  friendlyName: string;
  authToken?: string;
  // string = set new value, null = explicitly clear, omit = leave unchanged
  testAccountSid?: string | null;
  testAuthToken?: string | null;
  phoneNumbers?: string[];
  isActive?: boolean;
  sayVoice?: string;
}

export async function getTwilioAccounts(
  token: string,
): Promise<{ accounts: TwilioAccountItem[] }> {
  return authRequest<{ accounts: TwilioAccountItem[] }>("/twilio-accounts", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createTwilioAccount(
  token: string,
  data: TwilioAccountInput,
): Promise<{ account: TwilioAccountItem }> {
  return authRequest<{ account: TwilioAccountItem }>("/twilio-accounts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateTwilioAccount(
  token: string,
  id: string,
  data: Partial<TwilioAccountInput>,
): Promise<{ account: TwilioAccountItem }> {
  return authRequest<{ account: TwilioAccountItem }>(`/twilio-accounts/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteTwilioAccount(
  token: string,
  id: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/twilio-accounts/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Email accounts (Control Panel)
// ---------------------------------------------------------------------------

export type EmailAccountRole =
  | "general_notifications"
  | "billing_notifications";

export interface EmailAccountItem {
  _id: string;
  friendlyName: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  isActive: boolean;
  roles: EmailAccountRole[];
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailAccountInput {
  friendlyName: string;
  host: string;
  port?: number;
  secure?: boolean;
  username: string;
  password?: string;
  fromName: string;
  fromEmail: string;
  isActive?: boolean;
  roles?: EmailAccountRole[];
}

export async function getEmailAccounts(
  token: string,
): Promise<{ accounts: EmailAccountItem[] }> {
  return authRequest<{ accounts: EmailAccountItem[] }>("/email-accounts", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createEmailAccount(
  token: string,
  data: EmailAccountInput,
): Promise<{ account: EmailAccountItem }> {
  return authRequest<{ account: EmailAccountItem }>("/email-accounts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateEmailAccount(
  token: string,
  id: string,
  data: Partial<EmailAccountInput>,
): Promise<{ account: EmailAccountItem }> {
  return authRequest<{ account: EmailAccountItem }>(`/email-accounts/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteEmailAccount(
  token: string,
  id: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/email-accounts/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface EmailAccountTestResult {
  messageId?: string;
  accepted: string[];
  rejected: string[];
  response?: string;
  from: string;
  to: string;
  host: string;
  port: number;
  secure: boolean;
}

export async function testEmailAccount(
  token: string,
  id: string,
  to: string,
): Promise<{ message: string; result: EmailAccountTestResult }> {
  return authRequest<{ message: string; result: EmailAccountTestResult }>(
    `/email-accounts/${id}/test`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to }),
    },
  );
}

// ---------------------------------------------------------------------------
// Payment provider accounts (Control Panel)
// ---------------------------------------------------------------------------

export type PaymentProviderName = "square" | "stripe" | "paypal";
export type PaymentAuthMethod = "manual" | "oauth";

export interface PaymentProviderOwnerSummary {
  _id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface SquareOAuthAppConfig {
  productionApplicationId: string;
  sandboxApplicationId: string;
  hasProductionApplicationSecret: boolean;
  hasSandboxApplicationSecret: boolean;
  envConfigured: {
    production: boolean;
    sandbox: boolean;
  };
}

export interface SquareOAuthStatus {
  sandbox: boolean;
  production: boolean;
  forEnvironment: boolean;
  callbackUrl: string;
  sandboxSource?: "env" | "control-panel" | "none";
  productionSource?: "env" | "control-panel" | "none";
  app?: SquareOAuthAppConfig;
}

export interface PaymentProviderAccountItem {
  _id: string;
  provider: PaymentProviderName;
  friendlyName: string;
  environment: "sandbox" | "production";
  isActive: boolean;
  isDefault: boolean;
  ownerUserRef: string | null;
  owner: PaymentProviderOwnerSummary | null;
  authMethod: PaymentAuthMethod;
  applicationId: string | null;
  locationId: string | null;
  merchantId: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  publishableKey: string | null;
  clientId: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasWebhookSignatureKey: boolean;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  hasClientSecret: boolean;
  hasWebhookId: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentProviderAccountInput {
  provider: PaymentProviderName;
  friendlyName: string;
  environment?: "sandbox" | "production";
  isActive?: boolean;
  isDefault?: boolean;
  /** Null = global fallback. Omit on create defaults to global for admins / self for owners. */
  ownerUserId?: string | null;
  applicationId?: string;
  locationId?: string;
  publishableKey?: string;
  clientId?: string;
  accessToken?: string;
  webhookSignatureKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  clientSecret?: string;
  webhookId?: string;
}

export interface PaymentPlatformReady {
  sandbox: boolean;
  production: boolean;
  configured: boolean;
}

export interface PaymentPlatformsReady {
  square: PaymentPlatformReady;
  stripe: PaymentPlatformReady;
  paypal: PaymentPlatformReady;
}

export async function getPaymentProviderAccounts(token: string): Promise<{
  accounts: PaymentProviderAccountItem[];
  webhooks: Record<string, string>;
  squareOAuth: SquareOAuthStatus;
  platforms: PaymentPlatformsReady;
}> {
  return authRequest<{
    accounts: PaymentProviderAccountItem[];
    webhooks: Record<string, string>;
    squareOAuth: SquareOAuthStatus;
    platforms: PaymentPlatformsReady;
  }>("/payment-provider-accounts", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function startSquareOAuth(
  token: string,
  data: {
    environment?: "sandbox" | "production";
    ownerUserId?: string | null;
    friendlyName?: string;
  },
): Promise<{ authorizeUrl: string; callbackUrl: string }> {
  return authRequest<{ authorizeUrl: string; callbackUrl: string }>(
    "/payment-provider-accounts/square/oauth/start",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function createPaymentProviderAccount(
  token: string,
  data: PaymentProviderAccountInput,
): Promise<{ account: PaymentProviderAccountItem }> {
  return authRequest<{ account: PaymentProviderAccountItem }>(
    "/payment-provider-accounts",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updatePaymentProviderAccount(
  token: string,
  id: string,
  data: Partial<PaymentProviderAccountInput>,
): Promise<{ account: PaymentProviderAccountItem }> {
  return authRequest<{ account: PaymentProviderAccountItem }>(
    `/payment-provider-accounts/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deletePaymentProviderAccount(
  token: string,
  id: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/payment-provider-accounts/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Payment platform apps (Admin Panel)
// ---------------------------------------------------------------------------

export interface StripePlatformAppStatus extends PaymentPlatformReady {
  productionPublishableKey: string;
  sandboxPublishableKey: string;
  productionClientId: string;
  sandboxClientId: string;
  hasProductionSecretKey: boolean;
  hasSandboxSecretKey: boolean;
}

export interface PayPalPlatformAppStatus extends PaymentPlatformReady {
  productionClientId: string;
  sandboxClientId: string;
  hasProductionClientSecret: boolean;
  hasSandboxClientSecret: boolean;
}

export interface PaymentPlatformAppsPayload {
  square: SquareOAuthStatus;
  stripe: StripePlatformAppStatus;
  paypal: PayPalPlatformAppStatus;
}

export async function getPaymentPlatformApps(
  token: string,
): Promise<PaymentPlatformAppsPayload> {
  return authRequest<PaymentPlatformAppsPayload>("/payment-platform-apps", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function savePaymentPlatformApp(
  token: string,
  provider: PaymentProviderName,
  data: Record<string, string | boolean | undefined>,
): Promise<PaymentPlatformAppsPayload> {
  return authRequest<PaymentPlatformAppsPayload>(
    `/payment-platform-apps/${provider}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

// ---------------------------------------------------------------------------
// Google credentials (Control Panel)
// ---------------------------------------------------------------------------

export interface GoogleCredentialsItem {
  _id: string;
  label: string;
  projectId: string;
  isActive: boolean;
  hasApiKey: boolean;
  hasMapsBrowserApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCredentialsInput {
  label?: string;
  apiKey?: string;
  mapsBrowserApiKey?: string;
  clearMapsBrowserApiKey?: boolean;
  projectId?: string;
  isActive?: boolean;
}

export async function getGoogleCredentials(
  token: string,
): Promise<{ credentials: GoogleCredentialsItem | null }> {
  return authRequest<{ credentials: GoogleCredentialsItem | null }>(
    "/google-credentials",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getGoogleMapsBrowserKey(
  token: string,
): Promise<{ apiKey: string }> {
  return authRequest<{ apiKey: string }>(
    "/google-credentials/maps-browser-key",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function saveGoogleCredentials(
  token: string,
  data: GoogleCredentialsInput,
): Promise<{ credentials: GoogleCredentialsItem }> {
  return authRequest<{ credentials: GoogleCredentialsItem }>(
    "/google-credentials",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteGoogleCredentials(
  token: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/google-credentials", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// reCAPTCHA credentials (Control Panel → API Services)
// ---------------------------------------------------------------------------

export type RecaptchaVersion = "v2" | "v3";

export interface RecaptchaCredentialsItem {
  _id: string;
  siteKey: string;
  version: RecaptchaVersion;
  minScore: number;
  isActive: boolean;
  hasSecretKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecaptchaCredentialsInput {
  siteKey?: string;
  secretKey?: string;
  version?: RecaptchaVersion;
  minScore?: number;
  isActive?: boolean;
}

export interface RecaptchaSiteKeyResponse {
  siteKey: string | null;
  version: RecaptchaVersion;
}

export async function getRecaptchaSiteKey(): Promise<RecaptchaSiteKeyResponse> {
  const res = await fetch(`${API_URL}/recaptcha-credentials/site-key`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      body.message ?? "Failed to load reCAPTCHA.",
      res.status,
    );
  }
  return body as RecaptchaSiteKeyResponse;
}

export async function getRecaptchaCredentials(
  token: string,
): Promise<{ credentials: RecaptchaCredentialsItem | null }> {
  return authRequest<{ credentials: RecaptchaCredentialsItem | null }>(
    "/recaptcha-credentials",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function saveRecaptchaCredentials(
  token: string,
  data: RecaptchaCredentialsInput,
): Promise<{ credentials: RecaptchaCredentialsItem }> {
  return authRequest<{ credentials: RecaptchaCredentialsItem }>(
    "/recaptcha-credentials",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteRecaptchaCredentials(
  token: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/recaptcha-credentials", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Cloudinary credentials and public image assets
// ---------------------------------------------------------------------------

export interface CloudinaryCredentialsItem {
  _id: string;
  cloudName: string;
  uploadPreset?: string;
  isActive: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CloudinaryCredentialsInput {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
  uploadPreset?: string;
  isActive?: boolean;
}

export async function getCloudinaryCredentials(
  token: string,
): Promise<{ credentials: CloudinaryCredentialsItem | null }> {
  return authRequest<{ credentials: CloudinaryCredentialsItem | null }>(
    "/cloudinary-credentials",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function saveCloudinaryCredentials(
  token: string,
  data: CloudinaryCredentialsInput,
): Promise<{ credentials: CloudinaryCredentialsItem }> {
  return authRequest<{ credentials: CloudinaryCredentialsItem }>(
    "/cloudinary-credentials",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteCloudinaryCredentials(
  token: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/cloudinary-credentials", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getContactFormSettings(
  token: string,
): Promise<{ emails: string[] }> {
  return authRequest<{ emails: string[] }>("/contact-form-settings", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveContactFormSettings(
  token: string,
  emails: string[],
): Promise<{ emails: string[] }> {
  return authRequest<{ emails: string[] }>("/contact-form-settings", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ emails }),
  });
}

export interface PublicAssetItem {
  _id: string;
  slug: string;
  title: string;
  mimeType: string;
  publicUrl: string;
  isActive: boolean;
  uploadedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAssetUploadInput {
  file: File;
  slug?: string;
  title?: string;
}

export async function listPublicAssets(
  token: string,
): Promise<{ assets: PublicAssetItem[] }> {
  return authRequest<{ assets: PublicAssetItem[] }>("/public-assets", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function uploadPublicAsset(
  token: string,
  input: PublicAssetUploadInput,
): Promise<{ asset: PublicAssetItem }> {
  const payload = new FormData();
  payload.append("file", input.file);
  if (input.slug) payload.append("slug", input.slug);
  if (input.title) payload.append("title", input.title);

  return authRequest<{ asset: PublicAssetItem }>("/public-assets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  });
}

export async function togglePublicAssetStatus(
  token: string,
  id: string,
  isActive: boolean,
): Promise<{ asset: PublicAssetItem }> {
  return authRequest<{ asset: PublicAssetItem }>(
    `/public-assets/${id}/status`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive }),
    },
  );
}

// ---------------------------------------------------------------------------
// Messaging (templates, contacts, send)
// ---------------------------------------------------------------------------

export type { EmailChrome };
export type MessageTemplateType = "sms" | "email";

export interface MessageTemplateItem {
  _id: string;
  name: string;
  slug: string;
  body: string;
  subject: string;
  templateType: MessageTemplateType;
  emailChrome?: EmailChrome;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplateInput {
  name: string;
  body?: string;
  subject?: string;
  templateType?: MessageTemplateType;
  emailChrome?: EmailChrome;
  slug?: string;
}

export interface MergeFieldItem {
  key: string;
  label: string;
  description: string;
  templateTypes?: MessageTemplateType[];
}

export interface MessagingContactItem {
  _id: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
  customerRef: string;
  customer: {
    _id: string;
    accountName?: string;
    first: string;
    last: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  renewalDueDate: string | null;
  contractType: string | null;
  hasPayableInvoice?: boolean;
}

export interface MessagingPreviewResult {
  rendered: string;
  context: Record<string, string>;
  sample: boolean;
}

export interface MessagingSendResultItem {
  contactId: string;
  status: "sent" | "failed";
  twilioSid?: string;
  threadId?: string;
  error?: string;
}

export interface MessagingSendResponse {
  results: MessagingSendResultItem[];
  summary: { total: number; sent: number; failed: number };
  fromNumber: string;
  twilioAccountId: string;
  accountSid?: string;
  channel?: "sms" | "mms";
}

export type CommunicationChannel = "sms" | "mms" | "voice";
export type CommunicationDirection = "outbound" | "inbound";

export interface TwilioCommunicationItem {
  _id: string;
  twilioAccountRef: string | null;
  accountSid: string;
  accountFriendlyName: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  transcript: string;
  transcriptLines?: { kind: "event" | "voicemail"; text: string }[];
  mediaUrls: string[];
  durationSeconds: number | null;
  twilioSid: string | null;
  customerRef: string | null;
  contactRef: string | null;
  threadRef: string | null;
  templateRef: string | null;
  createdByUserRef: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageThreadStatus = "open" | "closed";

export interface MessageThreadItem {
  _id: string;
  contactRef: string | null;
  customerRef: string | null;
  twilioAccountRef: string;
  accountSid: string;
  accountFriendlyName: string | null;
  ourNumber: string;
  contactPhoneSnapshot: string;
  status: MessageThreadStatus;
  startedByUserRef: string | null;
  closedAt: string | null;
  closedByUserRef: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: CommunicationDirection | null;
  lastMessageChannel: CommunicationChannel | null;
  lastMessagePreview: string;
  messageCount: number;
  contact: {
    _id: string;
    first: string;
    last: string;
    phone: string;
    label: string;
    customerRef: string;
  } | null;
  customer: {
    _id: string;
    accountName?: string;
    first: string;
    last: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageThreadDetail {
  thread: MessageThreadItem;
  messages: TwilioCommunicationItem[];
}

export interface ThreadConflictCheck {
  hasOpenThread: boolean;
  openThread: MessageThreadItem | null;
}

export interface MessagingWebhookInfo {
  environment: TwilioRuntimeEnvironment;
  credentialsInUse: TwilioCredentialPair;
  messageWebhookUrl: string;
  voiceWebhookUrl: string;
  recordingWebhookUrl: string;
  statusWebhookUrl: string;
  accounts: Array<{
    _id: string;
    friendlyName: string;
    accountSid: string;
    isActive: boolean;
    messageWebhookUrl: string;
    voiceWebhookUrl: string;
    recordingWebhookUrl: string;
    statusWebhookUrl: string;
  }>;
}

export async function getMessageTemplates(
  token: string,
  options?: { includeDeleted?: boolean; templateType?: MessageTemplateType },
): Promise<{ templates: MessageTemplateItem[] }> {
  const params = new URLSearchParams();
  if (options?.includeDeleted) params.set("includeDeleted", "1");
  if (options?.templateType) params.set("templateType", options.templateType);
  const qs = params.toString();
  return authRequest<{ templates: MessageTemplateItem[] }>(
    `/message-templates${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createMessageTemplate(
  token: string,
  data: MessageTemplateInput,
): Promise<{ template: MessageTemplateItem }> {
  return authRequest<{ template: MessageTemplateItem }>("/message-templates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateMessageTemplate(
  token: string,
  id: string,
  data: Partial<MessageTemplateInput>,
): Promise<{ template: MessageTemplateItem }> {
  return authRequest<{ template: MessageTemplateItem }>(
    `/message-templates/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteMessageTemplate(
  token: string,
  id: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/message-templates/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMessagingMergeFields(
  token: string,
): Promise<{ fields: MergeFieldItem[] }> {
  return authRequest<{ fields: MergeFieldItem[] }>("/messaging/merge-fields", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function searchMessagingContacts(
  token: string,
  options?: {
    search?: string;
    year?: number;
    month?: number;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  contacts: MessagingContactItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  if (options?.year !== undefined) params.set("year", String(options.year));
  if (options?.month !== undefined) params.set("month", String(options.month));
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    contacts: MessagingContactItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/messaging/contacts${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function previewMessagingMessage(
  token: string,
  data: {
    body: string;
    contactId?: string;
    renewalYear?: number;
    renewalMonth?: number;
  },
): Promise<MessagingPreviewResult> {
  return authRequest<MessagingPreviewResult>("/messaging/preview", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function sendMessagingMessages(
  token: string,
  data: {
    contactIds: string[];
    body?: string;
    templateId?: string;
    threadId?: string;
    twilioAccountId?: string;
    fromNumber?: string;
    mediaUrls?: string[];
    renewalYear?: number;
    renewalMonth?: number;
  },
): Promise<MessagingSendResponse> {
  return authRequest<MessagingSendResponse>("/messaging/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function placeMessagingCall(
  token: string,
  data: {
    contactId: string;
    twilioAccountId?: string;
    fromNumber?: string;
    sayText?: string;
  },
): Promise<{ communication: TwilioCommunicationItem }> {
  return authRequest<{ communication: TwilioCommunicationItem }>(
    "/messaging/calls",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function getMessagingCommunications(
  token: string,
  options?: {
    twilioAccountId?: string;
    accountSid?: string;
    customerId?: string;
    contactId?: string;
    channel?: CommunicationChannel | "all";
    direction?: CommunicationDirection;
    unmatched?: boolean;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  communications: TwilioCommunicationItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.twilioAccountId) {
    params.set("twilioAccountId", options.twilioAccountId);
  }
  if (options?.accountSid) params.set("accountSid", options.accountSid);
  if (options?.customerId) params.set("customerId", options.customerId);
  if (options?.contactId) params.set("contactId", options.contactId);
  if (options?.channel && options.channel !== "all") {
    params.set("channel", options.channel);
  }
  if (options?.direction) params.set("direction", options.direction);
  if (options?.unmatched) params.set("unmatched", "1");
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    communications: TwilioCommunicationItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/messaging/communications${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMessagingThreads(
  token: string,
  options?: {
    twilioAccountId?: string;
    customerId?: string;
    contactId?: string;
    status?: MessageThreadStatus;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  threads: MessageThreadItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.twilioAccountId) {
    params.set("twilioAccountId", options.twilioAccountId);
  }
  if (options?.customerId) params.set("customerId", options.customerId);
  if (options?.contactId) params.set("contactId", options.contactId);
  if (options?.status) params.set("status", options.status);
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    threads: MessageThreadItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/messaging/threads${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMessagingThreadDetail(
  token: string,
  threadId: string,
): Promise<MessageThreadDetail> {
  return authRequest<MessageThreadDetail>(`/messaging/threads/${threadId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function checkMessagingThreadConflict(
  token: string,
  options: { contactId: string; fromNumber: string; excludeThreadId?: string },
): Promise<ThreadConflictCheck> {
  const params = new URLSearchParams();
  params.set("contactId", options.contactId);
  params.set("fromNumber", options.fromNumber);
  if (options.excludeThreadId) {
    params.set("excludeThreadId", options.excludeThreadId);
  }
  return authRequest<ThreadConflictCheck>(
    `/messaging/threads/check-conflict?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function closeMessagingThread(
  token: string,
  threadId: string,
): Promise<{ thread: MessageThreadItem }> {
  return authRequest<{ thread: MessageThreadItem }>(
    `/messaging/threads/${threadId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "closed" }),
    },
  );
}

export async function getMessagingWebhookInfo(
  token: string,
): Promise<MessagingWebhookInfo> {
  return authRequest<MessagingWebhookInfo>("/messaging/webhook-info", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Contract templates (Control Panel catalog)
// ---------------------------------------------------------------------------

export interface ContractTemplateItem {
  _id: string;
  label: string;
  slug: string;
  body: string;
  cost: number;
  badgeIcon: string;
  productDiscounts: ProductDiscounts;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractTemplateInput {
  label: string;
  body?: string;
  cost?: number;
  badgeIcon?: string;
  slug?: string;
  productDiscounts?: ProductDiscounts;
}

export async function getContractTemplates(
  token: string,
  options?: { includeDeleted?: boolean },
): Promise<{ templates: ContractTemplateItem[] }> {
  const params = options?.includeDeleted ? "?includeDeleted=1" : "";
  return authRequest<{ templates: ContractTemplateItem[] }>(
    `/contract-templates${params}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createContractTemplate(
  token: string,
  data: ContractTemplateInput,
): Promise<{ template: ContractTemplateItem }> {
  return authRequest<{ template: ContractTemplateItem }>(
    "/contract-templates",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updateContractTemplate(
  token: string,
  id: string,
  data: Partial<ContractTemplateInput>,
): Promise<{ template: ContractTemplateItem }> {
  return authRequest<{ template: ContractTemplateItem }>(
    `/contract-templates/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function duplicateContractTemplate(
  token: string,
  id: string,
): Promise<{ template: ContractTemplateItem }> {
  return authRequest<{ template: ContractTemplateItem }>(
    `/contract-templates/${id}/duplicate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function deleteContractTemplate(
  token: string,
  id: string,
): Promise<{ template: ContractTemplateItem; message: string }> {
  return authRequest<{ template: ContractTemplateItem; message: string }>(
    `/contract-templates/${id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationEntityType =
  | "customer"
  | "contact"
  | "address"
  | "equipment"
  | "work_order"
  | "contract"
  | "customer_note"
  | "user"
  | "role"
  | "twilio_account"
  | "email_account"
  | "contract_template"
  | "lead"
  | "google_credentials"
  | "recaptcha_credentials"
  | "payment_provider_account"
  | "invoice"
  | "product"
  | "estimate";

export type NotificationAction =
  | "created"
  | "updated"
  | "deleted"
  | "merged"
  | "renewed";

export interface NotificationItem {
  id: string;
  entityType: NotificationEntityType;
  action: NotificationAction;
  actorType: "user" | "system";
  actorUserId: string | null;
  actorName: string;
  customerRef: string | null;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export async function getNotifications(
  token: string,
  opts: { limit?: number; before?: string } = {},
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.before) params.set("before", opts.before);
  const qs = params.toString();
  return authRequest<{ items: NotificationItem[]; nextCursor: string | null }>(
    `/notifications${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getNotificationUnreadCount(
  token: string,
): Promise<{ count: number }> {
  return authRequest<{ count: number }>("/notifications/unread-count", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function markNotificationRead(
  token: string,
  id: string,
): Promise<{ ok: boolean }> {
  return authRequest<{ ok: boolean }>(`/notifications/${id}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function markAllNotificationsRead(
  token: string,
): Promise<{ marked: number }> {
  return authRequest<{ marked: number }>("/notifications/read-all", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Outbound email (wizard, preview, sent history)
// ---------------------------------------------------------------------------

export interface EmailSendAccountItem {
  _id: string;
  friendlyName: string;
  fromName: string;
  fromEmail: string;
  isActive: boolean;
}

export interface EmailPreviewResult {
  renderedSubject: string;
  renderedBody: string;
  html: string;
  context: Record<string, string>;
  sample: boolean;
}

export interface EmailSendResultItem {
  contactId: string;
  status: "sent" | "failed";
  emailId?: string;
  error?: string;
}

export interface EmailSendResponse {
  results: EmailSendResultItem[];
  summary: { total: number; sent: number; failed: number };
  fromName: string;
  fromEmail: string;
  emailAccountId: string;
}

export interface EmailCommunicationItem {
  _id: string;
  emailAccountRef: string | null;
  accountFriendlyName: string | null;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  html: string;
  status: "sent" | "failed";
  providerMessageId: string | null;
  errorMessage: string | null;
  customerRef: string | null;
  contactRef: string | null;
  templateRef: string | null;
  createdByUserRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getEmailSendAccounts(
  token: string,
): Promise<{ accounts: EmailSendAccountItem[] }> {
  return authRequest<{ accounts: EmailSendAccountItem[] }>(
    "/email-messages/accounts",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function searchEmailContacts(
  token: string,
  options?: {
    search?: string;
    year?: number;
    month?: number;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  contacts: MessagingContactItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  if (options?.year !== undefined) params.set("year", String(options.year));
  if (options?.month !== undefined) params.set("month", String(options.month));
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    contacts: MessagingContactItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/email-messages/contacts${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getEmailPaymentLinkAvailability(
  token: string,
  customerIds: string[],
): Promise<{ available: { customerId: string; hasPayableInvoice: boolean }[] }> {
  return authRequest<{
    available: { customerId: string; hasPayableInvoice: boolean }[];
  }>("/email-messages/payment-link-availability", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerIds }),
  });
}

export async function previewEmailMessage(
  token: string,
  data: {
    subject: string;
    body: string;
    emailChrome?: EmailChrome;
    contactId?: string;
    renewalYear?: number;
    renewalMonth?: number;
    includePaymentLink?: boolean;
  },
): Promise<EmailPreviewResult> {
  return authRequest<EmailPreviewResult>("/email-messages/preview", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function sendEmailMessages(
  token: string,
  data: {
    contactIds: string[];
    subject?: string;
    body?: string;
    emailChrome?: EmailChrome;
    templateId?: string;
    emailAccountId: string;
    fromName?: string;
    replyTo?: string;
    emailsPerSecond?: number;
    renewalYear?: number;
    renewalMonth?: number;
    includePaymentLink?: boolean;
  },
): Promise<EmailSendResponse> {
  return authRequest<EmailSendResponse>("/email-messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function getSentEmails(
  token: string,
  options?: {
    customerId?: string;
    contactId?: string;
    emailAccountId?: string;
    status?: "sent" | "failed";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  emails: EmailCommunicationItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.customerId) params.set("customerId", options.customerId);
  if (options?.contactId) params.set("contactId", options.contactId);
  if (options?.emailAccountId) {
    params.set("emailAccountId", options.emailAccountId);
  }
  if (options?.status) params.set("status", options.status);
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    emails: EmailCommunicationItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/email-messages${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getSentEmail(
  token: string,
  id: string,
): Promise<{ email: EmailCommunicationItem }> {
  return authRequest<{ email: EmailCommunicationItem }>(
    `/email-messages/${id}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}
