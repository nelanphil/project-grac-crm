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
  user: Pick<AuthUser, "id" | "email" | "first_name" | "last_name" | "role">;
}

async function authRequest<T>(
  endpoint: string,
  options: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });

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
}): Promise<RegisterResponse> {
  return authRequest<RegisterResponse>("/auth/register", {
    method: "POST",
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
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/auth/forgot-password", {
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

export interface UserListItem {
  _id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AuthUser["role"];
  username: string | null;
  usernameNumber: number | null;
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

export interface CustomerAddress {
  _id: string;
  customerRef: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
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

export interface CustomerListItem {
  _id: string;
  legacyId: number;
  first: string;
  last: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  generatorModel: string;
  lastSvc: string | null;
  deletedAt?: string | null;
  /** Other open customers sharing this phone (from list API). */
  duplicateCount?: number;
}

export interface CreateCustomerInput {
  first: string;
  last: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export async function getCustomers(
  token: string,
  options?: { deletedOnly?: boolean },
): Promise<{ customers: CustomerListItem[] }> {
  const params = options?.deletedOnly ? "?deleted=1" : "";
  return authRequest<{ customers: CustomerListItem[] }>(`/customers${params}`, {
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

export interface ValidatedAddress {
  address: string;
  city: string;
  state: string;
  zip: string;
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
  first: string;
  last: string;
  address: string;
  city: string;
  state: string;
  zip: string;
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
    first: string;
    last: string;
    phone: string;
    email?: string;
  };
  source: {
    _id: string;
    legacyId: number;
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
    isPrimary?: boolean;
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
    first: string;
    last: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
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
  hasTestAuthToken: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TwilioAccountInput {
  accountSid: string;
  friendlyName: string;
  authToken?: string;
  testAuthToken?: string;
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
  | "contract_template"
  | "lead";

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
