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
