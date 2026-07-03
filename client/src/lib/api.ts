import type { EstimatePayload } from "./estimate-types";
import type { AuthUser } from "@/store/useAuthStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function submitLead(
  data: EstimatePayload
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
      body.errors
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
  options: RequestInit
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
      body.errors
    );
  }

  return body as T;
}

export async function authLogin(
  email: string,
  password: string
): Promise<LoginResponse> {
  return authRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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
  data: { first_name?: string; last_name?: string; email?: string }
): Promise<{ user: AuthUser }> {
  return authRequest<{ user: AuthUser }>("/auth/me", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updatePassword(
  token: string,
  data: { current_password: string; new_password: string }
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/auth/me/password", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export interface UserListItem {
  _id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AuthUser["role"];
  createdAt: string;
}

export async function getUsers(token: string): Promise<{ users: UserListItem[] }> {
  return authRequest<{ users: UserListItem[] }>("/users", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface CustomerListItem {
  _id: string;
  legacyId: number;
  first: string;
  last: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  zip: string;
  generatorModel: string;
  lastSvc: string | null;
}

export async function getCustomers(token: string): Promise<{ customers: CustomerListItem[] }> {
  return authRequest<{ customers: CustomerListItem[] }>("/customers", {
    method: "GET",
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
}

export async function getCustomer(
  token: string,
  id: string
): Promise<{ customer: CustomerDetail }> {
  return authRequest<{ customer: CustomerDetail }>(`/customers/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
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
}

export async function getWorkOrdersForCustomer(
  token: string,
  legacyId: number
): Promise<WorkOrderListItem[]> {
  return authRequest<WorkOrderListItem[]>(`/work-orders?customerId=${legacyId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface ContractListItem {
  _id: string;
  customerId: number;
  contractDate: string | null;
  description: string;
  customer: { _id: string; first: string; last: string } | null;
}

export async function getContracts(
  token: string
): Promise<{ contracts: ContractListItem[] }> {
  return authRequest<{ contracts: ContractListItem[] }>("/contracts", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getContractsForCustomer(
  token: string,
  legacyId: number
): Promise<{ contracts: ContractListItem[] }> {
  return authRequest<{ contracts: ContractListItem[] }>(
    `/contracts?customerId=${legacyId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

export async function getContract(
  token: string,
  id: string
): Promise<{ contract: ContractListItem }> {
  return authRequest<{ contract: ContractListItem }>(`/contracts/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createContract(
  token: string,
  data: { customerId: number; contractDate?: string | null; description?: string }
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
  data: { contractDate?: string | null; description?: string }
): Promise<{ contract: ContractListItem }> {
  return authRequest<{ contract: ContractListItem }>(`/contracts/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteContract(
  token: string,
  id: string
): Promise<void> {
  await authRequest<void>(`/contracts/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateUserRole(
  token: string,
  id: string,
  role: AuthUser["role"]
): Promise<{ user: UserListItem }> {
  return authRequest<{ user: UserListItem }>(`/users/${id}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
}

export async function getRolePermissions(
  token: string
): Promise<{ roles: Record<string, string[]> }> {
  return authRequest<{ roles: Record<string, string[]> }>("/roles/permissions", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
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
  label: string
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
  label: string
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
  data: { slug: string; label: string }
): Promise<{ role: RoleItem; oldSlug: string }> {
  return authRequest<{ role: RoleItem; oldSlug: string }>(`/roles/${slug}/rename`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteRole(
  token: string,
  slug: string
): Promise<{ message: string }> {
  return authRequest<{ message: string }>(`/roles/${slug}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateRolePermissions(
  token: string,
  role: string,
  permissions: string[]
): Promise<{ role: string; permissions: string[] }> {
  return authRequest<{ role: string; permissions: string[] }>(`/roles/${role}/permissions`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ permissions }),
  });
}
