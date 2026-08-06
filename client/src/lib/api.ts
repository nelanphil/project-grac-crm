import type { EstimatePayload } from "./estimate-types";
import type { AuthUser } from "@/store/useAuthStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009";

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
  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
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
  role?: "admin" | "manager" | "agent";
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

export interface UserListItem {
  _id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AuthUser["role"];
  username: string | null;
  usernameNumber: number | null;
  territories: UserTerritories;
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
  reassignment?: { status: "started" } | { processed: number; assigned: number };
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

export async function recalculateTerritories(
  token: string,
): Promise<{
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

export interface WorkOrderListItem {
  _id: string;
  legacyId: number;
  date: string | null;
  descPerform: string;
  descPerformed: string;
  tech: string;
  total: number;
  paid: boolean;
  completed: boolean;
  addressRef?: string | null;
  address?: CustomerAddressSummary | null;
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
): Promise<{ invoice: InvoiceItem }> {
  return authRequest<{ invoice: InvoiceItem }>(`/pay/${token}`, {
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

export interface TwilioAccountItem {
  _id: string;
  accountSid: string;
  friendlyName: string;
  phoneNumbers: string[];
  isActive: boolean;
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

export async function getPaymentProviderAccounts(token: string): Promise<{
  accounts: PaymentProviderAccountItem[];
  webhooks: Record<string, string>;
  squareOAuth: SquareOAuthStatus;
}> {
  return authRequest<{
    accounts: PaymentProviderAccountItem[];
    webhooks: Record<string, string>;
    squareOAuth: SquareOAuthStatus;
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

export async function saveSquareOAuthApp(
  token: string,
  data: {
    productionApplicationId?: string;
    productionApplicationSecret?: string;
    sandboxApplicationId?: string;
    sandboxApplicationSecret?: string;
    clearProductionApplicationSecret?: boolean;
    clearSandboxApplicationSecret?: boolean;
  },
): Promise<{ squareOAuth: SquareOAuthStatus }> {
  return authRequest<{ squareOAuth: SquareOAuthStatus }>(
    "/payment-provider-accounts/square/oauth/app",
    {
      method: "PUT",
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
// Messaging (templates, contacts, send)
// ---------------------------------------------------------------------------

export interface MessageTemplateItem {
  _id: string;
  name: string;
  slug: string;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplateInput {
  name: string;
  body?: string;
  slug?: string;
}

export interface MergeFieldItem {
  key: string;
  label: string;
  description: string;
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
  contactRef: string;
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
  messageWebhookUrl: string;
  statusWebhookUrl: string;
  accounts: Array<{
    _id: string;
    friendlyName: string;
    accountSid: string;
    isActive: boolean;
    messageWebhookUrl: string;
    statusWebhookUrl: string;
  }>;
}

export async function getMessageTemplates(
  token: string,
  options?: { includeDeleted?: boolean },
): Promise<{ templates: MessageTemplateItem[] }> {
  const params = options?.includeDeleted ? "?includeDeleted=1" : "";
  return authRequest<{ templates: MessageTemplateItem[] }>(
    `/message-templates${params}`,
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
  | "payment_provider_account"
  | "invoice";

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
