import { recordApiBreadcrumb } from "@/lib/crashBreadcrumbs";
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
  endpoint?: string;
  method?: string;
  requestId?: string;

  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string[]>,
    public code?: string,
    public payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function withRequestContext(
  error: ApiError,
  method: string,
  endpoint: string,
  res?: Response,
): ApiError {
  error.method = method.toUpperCase();
  error.endpoint = endpoint.split("?")[0] || endpoint;
  error.requestId = res ? requestIdOf(res) : undefined;
  return error;
}

function requestIdOf(res: Response): string | undefined {
  return res.headers.get("x-request-id") ?? undefined;
}

function elapsed(startedAt: number): number {
  return Date.now() - startedAt;
}

async function publicPost<T>(endpoint: string, data: unknown): Promise<T> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    recordApiBreadcrumb("POST", endpoint, 0, {
      durationMs: elapsed(startedAt),
      message: "Network error",
    });
    throw withRequestContext(
      new ApiError(
        "Could not reach the server. Check your connection and try again.",
        0,
      ),
      "POST",
      endpoint,
    );
  }

  const body = await res.json().catch(() => ({}));
  recordApiBreadcrumb("POST", endpoint, res.status, {
    durationMs: elapsed(startedAt),
    requestId: requestIdOf(res),
    message: typeof body.message === "string" ? body.message : undefined,
  });

  if (!res.ok) {
    throw withRequestContext(
      new ApiError(
        body.message ?? "Something went wrong. Please try again.",
        res.status,
        body.errors,
      ),
      "POST",
      endpoint,
      res,
    );
  }

  return body as T;
}

export async function submitLead(
  data: EstimatePayload,
): Promise<{ id: string; message: string }> {
  return publicPost("/leads", data);
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
  return publicPost("/contact", data);
}

export async function submitSmsOptIn(data: {
  phone: string;
  smsOptIn: true;
}): Promise<{ message: string }> {
  return publicPost("/sms-opt-in", data);
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
  const method = options.method ?? "GET";
  const startedAt = Date.now();

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
    recordApiBreadcrumb(method, endpoint, 0, {
      durationMs: elapsed(startedAt),
      message: "Network error",
    });
    throw withRequestContext(
      new ApiError(
        "Could not reach the server. Check your connection and try again.",
        0,
      ),
      method,
      endpoint,
    );
  }

  const body = await res.json().catch(() => ({}));

  recordApiBreadcrumb(method, endpoint, res.status, {
    durationMs: elapsed(startedAt),
    requestId: requestIdOf(res),
    message: typeof body.message === "string" ? body.message : undefined,
  });

  if (!res.ok) {
    throw withRequestContext(
      new ApiError(
        body.message ?? "Something went wrong. Please try again.",
        res.status,
        body.errors,
        typeof body.code === "string" ? body.code : undefined,
        body,
      ),
      method,
      endpoint,
      res,
    );
  }

  return body as T;
}

export type CrashReportStatus = "open" | "resolved";
export type CrashReportOrigin = "client" | "server";
export type CrashReportSource =
  | "render"
  | "window"
  | "unhandledrejection"
  | "chunk"
  | "server";

export interface CrashReportSummary {
  id: string;
  status: CrashReportStatus;
  origin: CrashReportOrigin;
  source: CrashReportSource;
  name: string;
  message: string;
  pathname: string;
  userEmail: string;
  userRole: string;
  reporterEmail: string;
  occurredAt: string;
  createdAt: string;
  resolvedAt: string | null;
  occurrences: number;
  lastSeenAt: string | null;
  httpStatus: number | null;
}

export interface CrashReportErrorPart {
  name: string;
  message: string;
  stack: string;
}

export interface CrashReportBreadcrumb {
  t: number;
  type: "route" | "click" | "api" | "console" | "error" | "lifecycle";
  detail: string;
  meta?: {
    status?: number;
    durationMs?: number;
    requestId?: string;
    message?: string;
  };
}

export interface CrashReportDecodedFrame {
  raw: string;
  fn: string;
  file: string;
  line: number;
  column: number;
  decoded: boolean;
  snippet?: string;
}

export interface CrashReportDetail extends CrashReportSummary {
  clientReportId: string | null;
  release: string;
  stack: string;
  decodedStack: string;
  decodedFrames: CrashReportDecodedFrame[];
  sourceMapsFound: number;
  componentStack: string;
  causes: CrashReportErrorPart[];
  context: Record<string, string | number | boolean>;
  additionalErrors: (CrashReportErrorPart & { source: string; at: string })[];
  url: string;
  userAgent: string;
  viewport: string;
  online: boolean;
  environment: Record<string, string | number | boolean>;
  whatWereYouDoing: string;
  whatHappened: string;
  breadcrumbs: CrashReportBreadcrumb[];
  requestId: string;
  requestIds: string[];
  http: {
    method: string;
    route: string;
    path: string;
    status: number;
    bodyKeys: string[];
  } | null;
  fingerprint: string;
  resolutionNote: string;
  resolvedByName: string;
  ip: string;
  relatedServerErrors: Omit<
    CrashReportDetail,
    "relatedServerErrors" | "relatedClientReports" | "decodedStack" | "decodedFrames" | "sourceMapsFound"
  >[];
  relatedClientReports: CrashReportSummary[];
}

export interface CrashReportListResponse {
  reports: CrashReportSummary[];
  total: number;
  page: number;
  pageSize: number;
  openCount: number;
  resolvedCount: number;
}

export async function listCrashReports(
  token: string,
  options?: {
    page?: number;
    pageSize?: number;
    status?: CrashReportStatus | "all";
    origin?: CrashReportOrigin | "all";
  },
): Promise<CrashReportListResponse> {
  const params = new URLSearchParams();
  if (options?.origin && options.origin !== "all") {
    params.set("origin", options.origin);
  }
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  if (options?.status && options.status !== "all") {
    params.set("status", options.status);
  }
  const qs = params.toString();
  return authRequest<CrashReportListResponse>(
    `/crash-reports${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getCrashReport(
  token: string,
  id: string,
): Promise<{ report: CrashReportDetail }> {
  return authRequest<{ report: CrashReportDetail }>(`/crash-reports/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateCrashReport(
  token: string,
  id: string,
  data: { status: CrashReportStatus; resolutionNote?: string },
): Promise<{ report: CrashReportDetail }> {
  return authRequest<{ report: CrashReportDetail }>(`/crash-reports/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export interface CustomerNameRow {
  id: string;
  accountName: string;
  first: string;
  last: string;
}

export interface ContactNameRow {
  id: string;
  first: string;
  last: string;
  isPrimary: boolean;
  customerId: string;
  customerName: string;
}

export interface NameReportPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

function nameReportQuery(options?: {
  page?: number;
  pageSize?: number;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  if (options?.q?.trim()) params.set("q", options.q.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listCustomerNames(
  token: string,
  options?: { page?: number; pageSize?: number; q?: string },
): Promise<NameReportPage<CustomerNameRow>> {
  return authRequest<NameReportPage<CustomerNameRow>>(
    `/name-reports/customers${nameReportQuery(options)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function updateCustomerName(
  token: string,
  id: string,
  data: { accountName?: string; first?: string; last?: string },
): Promise<{
  row: CustomerNameRow;
  contact: { id: string; first: string; last: string; isPrimary: boolean } | null;
}> {
  return authRequest<{
    row: CustomerNameRow;
    contact: { id: string; first: string; last: string; isPrimary: boolean } | null;
  }>(
    `/name-reports/customers/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function listContactNames(
  token: string,
  options?: { page?: number; pageSize?: number; q?: string },
): Promise<NameReportPage<ContactNameRow>> {
  return authRequest<NameReportPage<ContactNameRow>>(
    `/name-reports/contacts${nameReportQuery(options)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function updateContactName(
  token: string,
  id: string,
  data: { first?: string; last?: string },
): Promise<{ row: ContactNameRow; customer: CustomerNameRow | null }> {
  return authRequest<{ row: ContactNameRow; customer: CustomerNameRow | null }>(
    `/name-reports/contacts/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const normalized = block.replace(/\r/g, "");
  if (!normalized.trim()) return null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

async function streamAuthRequest(
  endpoint: string,
  options: RequestInit,
  onEvent: (event: string, data: unknown) => void,
): Promise<unknown> {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const method = options.method ?? "GET";
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers ?? {}),
        Accept: "text/event-stream",
      },
    });
  } catch {
    recordApiBreadcrumb(method, endpoint, 0, {
      durationMs: elapsed(startedAt),
      message: "Network error",
    });
    throw withRequestContext(
      new ApiError(
        "Could not reach the server. Check your connection and try again.",
        0,
      ),
      method,
      endpoint,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      errors?: Record<string, string[]>;
    };
    recordApiBreadcrumb(method, endpoint, res.status, {
      durationMs: elapsed(startedAt),
      requestId: requestIdOf(res),
      message: typeof body.message === "string" ? body.message : undefined,
    });
    if (!res.ok) {
      throw withRequestContext(
        new ApiError(
          body.message ?? "Something went wrong. Please try again.",
          res.status,
          body.errors,
        ),
        method,
        endpoint,
        res,
      );
    }
    onEvent("result", body);
    onEvent("done", {});
    return body;
  }

  recordApiBreadcrumb(method, endpoint, res.status, {
    durationMs: elapsed(startedAt),
    requestId: requestIdOf(res),
  });

  if (!res.body) {
    throw new ApiError("Empty response from server.", res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastResult: unknown;
  let lastError: string | null = null;

  const consume = (part: string) => {
    const parsed = parseSseBlock(part);
    if (!parsed) return;
    onEvent(parsed.event, parsed.data);
    if (parsed.event === "result") lastResult = parsed.data;
    if (parsed.event === "error") {
      const data = parsed.data as { message?: string };
      lastError =
        typeof data?.message === "string" ? data.message : "Request failed.";
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) consume(part);
  }
  if (buffer.trim()) consume(buffer);

  if (lastResult !== undefined) return lastResult;
  if (!res.ok) {
    throw new ApiError(
      lastError ?? "Something went wrong. Please try again.",
      res.status,
    );
  }
  return lastResult;
}

export interface LoginCoordinates {
  lat: number;
  lng: number;
}

/** Server code returned when a staff sign-in is missing browser coordinates. */
export const LOCATION_REQUIRED_CODE = "LOCATION_REQUIRED";

export async function authLogin(
  identifier: string,
  password: string,
  location?: LoginCoordinates,
): Promise<LoginResponse> {
  return authRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password, ...(location ? { location } : {}) }),
  });
}

export async function authUpdateLoginLocation(
  token: string,
  location: LoginCoordinates,
): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/me/login-location`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(location),
  });
  return res.ok;
}

export async function authTouchActivity(token: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/me/activity`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
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

export interface EmailPreferencePayload {
  email: string;
  generalNotifications: boolean;
  billingAlerts: boolean;
  channel?: "general" | "billing";
}

export async function updateMyNotifications(
  token: string,
  data: {
    generalNotifications?: boolean;
    billingAlerts?: boolean;
    smsOptIn?: boolean;
  },
): Promise<{ user: AuthUser }> {
  return authRequest<{ user: AuthUser }>("/auth/me/notifications", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function getPublicEmailPreferences(
  token: string,
): Promise<EmailPreferencePayload> {
  const params = new URLSearchParams({ token });
  return authRequest<EmailPreferencePayload>(
    `/email-preferences?${params.toString()}`,
    { method: "GET" },
  );
}

export async function updatePublicEmailPreferences(
  token: string,
  data: {
    generalNotifications?: boolean;
    billingAlerts?: boolean;
  },
): Promise<EmailPreferencePayload> {
  return authRequest<EmailPreferencePayload>("/email-preferences", {
    method: "PATCH",
    body: JSON.stringify({ token, ...data }),
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

/** A Google-confirmed city a technician covers. */
export interface ServiceCity {
  city: string;
  state: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
}

export interface CitySuggestion {
  placeId: string;
  label: string;
  city: string;
  state: string;
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

export interface UserCapabilities {
  schedulable: boolean;
  territoryOwner: boolean;
}

export interface UserLoginLocation {
  city: string;
  region: string;
  country: string;
  /** "device" from browser coordinates; "ip" (or missing) is an approximate IP guess. */
  source?: "device" | "ip";
}

export interface UserListItem {
  _id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AuthUser["role"];
  roles: string[];
  userType?: "staff" | "customer";
  jobRoles?: string[];
  jobRoleData?: Record<string, Record<string, unknown>>;
  capabilities?: UserCapabilities;
  schedulable?: boolean;
  username: string | null;
  usernameNumber: number | null;
  territories: UserTerritories;
  homeLocation: UserHomeLocation;
  weeklyHours: UserWeeklyHours;
  serviceCities: ServiceCity[];
  scheduleExceptions: ScheduleException[];
  phone: string;
  initials?: string;
  scheduleColor?: string;
  lastLoginAt?: string | null;
  lastActiveAt?: string | null;
  lastLoginLocation?: UserLoginLocation | null;
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
    role?: string;
    roles?: string[];
    userType?: "staff" | "customer";
    jobRoles?: string[];
    jobRoleData?: Record<string, Record<string, unknown>>;
    username?: string | null;
    territories?: UserTerritories;
    weeklyHours?: UserWeeklyHours;
    homeLocation?: UserHomeLocation;
    serviceCities?: ServiceCity[];
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
    roles?: string[];
    userType?: "staff" | "customer";
    jobRoles?: string[];
    jobRoleData?: Record<string, Record<string, unknown>>;
    username?: string | null;
    password?: string;
    territories?: UserTerritories;
    weeklyHours?: UserWeeklyHours;
    homeLocation?: UserHomeLocation;
    serviceCities?: ServiceCity[];
    scheduleExceptions?: ScheduleException[];
    phone?: string;
    initials?: string;
    scheduleColor?: string;
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
  customerRef: string | null;
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
  ownerManual?: boolean;
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
  body: {
    accountName?: string;
    ownerUserId?: string | null;
    ownerManual?: boolean;
  },
): Promise<{ customer: CustomerDetail }> {
  return authRequest<{ customer: CustomerDetail }>(`/customers/${id}`, {
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
  ownerManual?: boolean;
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

export type DuplicateSeverity = "none" | "warning" | "blocking";

export interface DuplicateFieldMatch extends CustomerDuplicateMatch {
  contactId?: string;
  isPrimaryContact?: boolean;
}

export interface DuplicateFieldResult {
  severity: DuplicateSeverity;
  message?: string;
  matches: DuplicateFieldMatch[];
}

export interface CheckCustomerDuplicatesInput {
  excludeId?: string;
  accountName?: string;
  contacts?: Array<{
    key: string;
    phone?: string;
    email?: string;
    isPrimary?: boolean;
  }>;
  addresses?: Array<{
    key: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  }>;
}

export interface CheckCustomerDuplicatesResult {
  accountName: DuplicateFieldResult;
  contacts: Record<
    string,
    { phone: DuplicateFieldResult; email: DuplicateFieldResult }
  >;
  addresses: Record<string, DuplicateFieldResult>;
}

export async function checkCustomerDuplicates(
  token: string,
  body: CheckCustomerDuplicatesInput,
): Promise<CheckCustomerDuplicatesResult> {
  return authRequest<CheckCustomerDuplicatesResult>(
    "/customers/check-duplicates",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
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
    invoices: number;
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

export async function detachCustomerContact(
  token: string,
  customerId: string,
  contactId: string,
): Promise<{ contact: CustomerContact }> {
  return authRequest<{ contact: CustomerContact }>(
    `/customers/${customerId}/contacts/${contactId}/detach`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface DirectoryContact {
  _id: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
  customerRef: string | null;
  customerName: string | null;
}

export async function searchDirectoryContacts(
  token: string,
  search: string,
  limit = 20,
): Promise<{ contacts: DirectoryContact[] }> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  params.set("limit", String(limit));
  return authRequest<{ contacts: DirectoryContact[] }>(`/contacts?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createDirectoryContact(
  token: string,
  data: {
    first: string;
    last: string;
    phone: string;
    email?: string;
    customerId?: string;
  },
): Promise<{ contact: DirectoryContact }> {
  return authRequest<{ contact: DirectoryContact }>("/contacts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function attachDirectoryContact(
  token: string,
  contactId: string,
  customerId: string,
): Promise<{ contact: DirectoryContact }> {
  return authRequest<{ contact: DirectoryContact }>(`/contacts/${contactId}/attach`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerId }),
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
  /** True only for notes nobody has opened yet. Older notes stay false. */
  unviewed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAttention {
  unviewedNotes: boolean;
  unreadCommunications: boolean;
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

export async function markCustomerNotesViewed(
  token: string,
  customerId: string,
  noteIds: string[],
): Promise<{ viewed: number }> {
  return authRequest<{ viewed: number }>(
    `/customers/${customerId}/notes/viewed`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ noteIds }),
    },
  );
}

export async function getCustomerAttention(
  token: string,
  customerId: string,
): Promise<CustomerAttention> {
  return authRequest<CustomerAttention>(`/customers/${customerId}/attention`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface CustomerActivityChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface CustomerActivityItem {
  id: string;
  customerRef: string;
  category: string;
  action: string;
  actorKind: "staff" | "customer" | "system";
  actorUserId: string | null;
  actorName: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  changes: CustomerActivityChange[];
  metadata: Record<string, unknown>;
  source: string;
  ip: string | null;
  backfilled: boolean;
  createdAt: string;
  customerName?: string | null;
}

export async function getAllCustomerActivity(
  token: string,
  opts: {
    before?: string;
    after?: string;
    limit?: number;
    categories?: string[];
    actorKind?: string | null;
  } = {},
): Promise<{ items: CustomerActivityItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts.before) params.set("before", opts.before);
  if (opts.after) params.set("after", opts.after);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.categories && opts.categories.length > 0) {
    params.set("categories", opts.categories.join(","));
  }
  if (opts.actorKind) params.set("actorKind", opts.actorKind);
  const query = params.toString();
  return authRequest<{ items: CustomerActivityItem[]; nextCursor: string | null }>(
    `/customer-activity${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getCustomerActivity(
  token: string,
  customerId: string,
  opts: {
    before?: string;
    after?: string;
    limit?: number;
    categories?: string[];
    actorKind?: string | null;
  } = {},
): Promise<{ items: CustomerActivityItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts.before) params.set("before", opts.before);
  if (opts.after) params.set("after", opts.after);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.categories && opts.categories.length > 0) {
    params.set("categories", opts.categories.join(","));
  }
  if (opts.actorKind) params.set("actorKind", opts.actorKind);
  const query = params.toString();
  return authRequest<{ items: CustomerActivityItem[]; nextCursor: string | null }>(
    `/customers/${customerId}/activity${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface WorkOrderNoteAuthor {
  first_name: string;
  last_name: string;
}

export interface NoteMention {
  id: string;
  firstName: string;
  lastName: string;
}

export type TicketNoteSource = "work-order" | "estimate";

export interface WorkOrderNote {
  _id: string;
  workOrderRef?: string;
  estimateRef?: string;
  authorId?: string;
  author?: WorkOrderNoteAuthor;
  content: string;
  visibleToCustomer: boolean;
  isReminder?: boolean;
  mentionUserIds?: string[];
  mentions?: NoteMention[];
  desiredStartTime?: string;
  desiredStartBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketNoteInput {
  content: string;
  visibleToCustomer?: boolean;
  templateId?: string;
  isReminder?: boolean;
  mentionUserIds?: string[];
}

function ticketNotesPath(source: TicketNoteSource, recordId: string): string {
  const root = source === "estimate" ? "estimates" : "work-orders";
  return `/${root}/${recordId}/notes`;
}

export interface RecentWorkOrderNote {
  id: string;
  content: string;
  createdAt: string;
  authorName: string;
  workOrderId: string;
  ticketNumber: string;
  customerName: string;
}

export interface WorkOrderNoteHistoryItem {
  id: string;
  content: string;
  workOrderId: string;
  ticketNumber: string;
  customerName: string;
  createdAt: string;
  canEdit: boolean;
}

export async function getWorkOrderNoteHistory(
  token: string,
  opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    sort?: "note" | "ticket" | "customer" | "created";
    dir?: "asc" | "desc";
  } = {},
): Promise<{
  notes: WorkOrderNoteHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  if (opts.search) params.set("search", opts.search);
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.dir) params.set("dir", opts.dir);
  const qs = params.toString();
  return authRequest(`/work-orders/notes${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getRecentWorkOrderNotes(
  token: string,
): Promise<{ notes: RecentWorkOrderNote[] }> {
  return authRequest<{ notes: RecentWorkOrderNote[] }>(
    "/work-orders/recent-notes",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getWorkOrderNotes(
  token: string,
  workOrderId: string,
  source: TicketNoteSource = "work-order",
): Promise<{ notes: WorkOrderNote[] }> {
  return authRequest<{ notes: WorkOrderNote[] }>(
    ticketNotesPath(source, workOrderId),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createWorkOrderNote(
  token: string,
  workOrderId: string,
  data: TicketNoteInput,
  source: TicketNoteSource = "work-order",
): Promise<{ note: WorkOrderNote; warnings?: string[] }> {
  return authRequest<{ note: WorkOrderNote; warnings?: string[] }>(
    ticketNotesPath(source, workOrderId),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updateWorkOrderNote(
  token: string,
  workOrderId: string,
  noteId: string,
  data: TicketNoteInput,
  source: TicketNoteSource = "work-order",
): Promise<{ note: WorkOrderNote; warnings?: string[] }> {
  return authRequest<{ note: WorkOrderNote; warnings?: string[] }>(
    `${ticketNotesPath(source, workOrderId)}/${noteId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteWorkOrderNote(
  token: string,
  workOrderId: string,
  noteId: string,
  source: TicketNoteSource = "work-order",
): Promise<{ warnings?: string[] }> {
  return authRequest<{ warnings?: string[] }>(
    `${ticketNotesPath(source, workOrderId)}/${noteId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface MentionableUser {
  id: string;
  firstName: string;
  lastName: string;
}

export async function searchMentionableUsers(
  token: string,
  search: string,
): Promise<{ users: MentionableUser[] }> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const qs = params.toString();
  return authRequest<{ users: MentionableUser[] }>(
    `/users/mentions${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export interface ReminderListItem {
  id: string;
  source: TicketNoteSource;
  content: string;
  ticketId: string;
  ticketNumber: string;
  customerName: string;
  authorName: string;
  createdAt: string;
  completed: boolean;
}

export async function getReminders(
  token: string,
  opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    sort?: "note" | "ticket" | "customer" | "created" | "completed";
    dir?: "asc" | "desc";
    showCompleted?: boolean;
  } = {},
): Promise<{
  reminders: ReminderListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  if (opts.search) params.set("search", opts.search);
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.dir) params.set("dir", opts.dir);
  if (opts.showCompleted) params.set("showCompleted", "true");
  const qs = params.toString();
  return authRequest(`/reminders${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateReminderCompleted(
  token: string,
  source: TicketNoteSource,
  noteId: string,
  completed: boolean,
): Promise<{ id: string; source: TicketNoteSource; completed: boolean }> {
  return authRequest(`/reminders/${source}/${noteId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ completed }),
  });
}

export type NoteTemplateScope = "global" | "personal";

export interface NoteTemplateItem {
  _id: string;
  name: string;
  body: string;
  scope: NoteTemplateScope;
  ownerId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getNoteTemplates(
  token: string,
): Promise<{ templates: NoteTemplateItem[] }> {
  return authRequest<{ templates: NoteTemplateItem[] }>("/note-templates", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createNoteTemplate(
  token: string,
  data: { name: string; body: string; scope?: NoteTemplateScope },
): Promise<{ template: NoteTemplateItem }> {
  return authRequest<{ template: NoteTemplateItem }>("/note-templates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateNoteTemplate(
  token: string,
  id: string,
  data: { name?: string; body?: string },
): Promise<{ template: NoteTemplateItem }> {
  return authRequest<{ template: NoteTemplateItem }>(`/note-templates/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteNoteTemplate(
  token: string,
  id: string,
): Promise<void> {
  await authRequest<Record<string, never>>(`/note-templates/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type TicketLineType = "product" | "note" | "agreement";
export type ProductKind = "part" | "labor" | "contract" | "equipment";

export interface WorkOrderPart {
  productRef?: string | null;
  contractTemplateRef?: string | null;
  enrolledContractRef?: string | null;
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

export interface WorkOrderTypeSummary {
  _id: string;
  label: string;
}

export interface WorkOrderListItem {
  _id: string;
  legacyId?: number;
  number?: string;
  date: string | null;
  startTime?: string | null;
  endTime?: string | null;
  desiredStartTime?: string | null;
  desiredStartBy?: string | null;
  descPerform: string;
  descPerformed: string;
  tech: string;
  total: number;
  totalParts?: number;
  totalLabor?: number;
  totalAgreements?: number;
  miscExp?: number;
  subtotal?: number;
  shipping?: number;
  taxRate?: number;
  tax?: number;
  taxOverridden?: boolean;
  paid: boolean;
  completed: boolean;
  laborHours?: number;
  runHours?: number;
  parts?: WorkOrderPart[];
  customerName?: string | null;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
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
  assignedUserRefs?: string[];
  assignees?: Array<{ _id: string; first_name: string; last_name: string }>;
  workOrderTypeRef?: string | null;
  workOrderType?: WorkOrderTypeSummary | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  estimatedMinutes?: number;
  routeLocked?: boolean;
  appointmentCanceledAt?: string | null;
  appointmentCanceledBy?: string | null;
  customerRef?: string | null;
  /** Primary customer contact's phone; only returned by schedule endpoints. */
  primaryContactPhone?: string | null;
  customerId?: number;
  assignee?: WorkOrderAssignee | null;
  warnings?: string[];
  scheduleNote?: string | null;
  deletedAt?: string | null;
  offlinePayment?: OfflinePayment | null;
}

export type ServiceTicketPayload = {
  customerId: number;
  addressRef?: string | null;
  equipmentRef?: string | null;
  estimateRef?: string | null;
  descPerform?: string;
  descPerformed?: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  tech?: string;
  assignedUserRef?: string | null;
  assignedUserRefs?: string[];
  workOrderTypeRef?: string | null;
  paid?: boolean;
  completed?: boolean;
  certify?: boolean;
  runHours?: number;
  laborHours?: number;
  totalLabor?: number;
  laborOverridden?: boolean;
  miscExp?: number;
  shipping?: number;
  taxRate?: number;
  tax?: number;
  taxOverridden?: boolean;
  parts?: WorkOrderPart[];
  customerName?: string;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
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
  contractRef?: string | null;
  contractDiscount?: TicketContractDiscount | null;
  status?: "draft" | "sent" | "accepted" | "declined" | "converted";
  notes?: Array<{
    content: string;
    visibleToCustomer?: boolean;
    isReminder?: boolean;
    mentionUserIds?: string[];
    templateId?: string;
  }>;
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
    deleted?: boolean;
  },
): Promise<{
  workOrders: WorkOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  stats?: { total: number; unpaid: number; paid: number };
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
  if (opts?.deleted) params.set("deleted", "1");
  return authRequest<{
    workOrders: WorkOrderListItem[];
    total: number;
    page: number;
    pageSize: number;
    stats?: { total: number; unpaid: number; paid: number };
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
  await authRequest(`/work-orders/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function restoreWorkOrder(token: string, id: string): Promise<void> {
  await authRequest(`/work-orders/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getWorkOrdersForCustomer(
  token: string,
  legacyId: number,
  addressId?: string,
  opts?: { deleted?: boolean },
): Promise<WorkOrderListItem[]> {
  const params = new URLSearchParams({ customerId: String(legacyId) });
  if (addressId) params.set("addressId", addressId);
  if (opts?.deleted) params.set("deleted", "1");
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

export interface WorkOrderCompletionContact {
  _id: string;
  name: string;
  phone: string;
  email: string;
  phoneValid: boolean;
  emailValid: boolean;
  isPrimary: boolean;
}

export interface OfflinePayment {
  method: "check" | "cash";
  checkNumber: string | null;
  proofUrl: string | null;
  recordedByUserId: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
}

export function offlinePaymentLabel(
  payment: Pick<OfflinePayment, "method" | "checkNumber">,
): string {
  if (payment.method === "cash") return "Cash";
  const number = payment.checkNumber?.trim();
  return number ? `Check #${number}` : "Check";
}

export interface WorkOrderCompletionCheck {
  totalCents: number;
  blockedReason: string | null;
  sendBlockedReason: string | null;
  invoiceOpen: boolean;
  offlinePayment?: OfflinePayment | null;
  contacts: WorkOrderCompletionContact[];
}

export type WorkOrderChannelDelivery =
  | { status: "sent" }
  | { status: "failed"; error: string }
  | { status: "skipped" };

export type InvoiceEmailReceipt =
  | { status: "sent"; to: string }
  | { status: "missing" }
  | { status: "invalid"; to: string }
  | { status: "skipped"; error: string }
  | { status: "failed"; error: string };

export type InvoiceTextReceipt =
  | { status: "sent"; to: string }
  | { status: "invalid" }
  | { status: "failed"; error: string };

export interface WorkOrderReceiptDelivery {
  email: InvoiceEmailReceipt;
  phone: string;
  phoneValid: boolean;
  viewUrl: string;
}

export interface WorkOrderCompletionResult {
  workOrder: WorkOrderListItem;
  invoice: { _id: string; number: string; amountCents: number };
  payUrl?: string;
  delivery?: {
    sms: WorkOrderChannelDelivery;
    email: WorkOrderChannelDelivery;
  };
  offlinePayment?: OfflinePayment;
  receipt?: WorkOrderReceiptDelivery;
}

export async function getWorkOrderCompletionCheck(
  token: string,
  id: string,
): Promise<WorkOrderCompletionCheck> {
  return authRequest<WorkOrderCompletionCheck>(
    `/work-orders/${id}/completion-check`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function completeWorkOrder(
  token: string,
  id: string,
  data:
    | { mode: "pay_now" }
    | {
        mode: "send" | "resend";
        contactId: string;
        phoneOverride?: string;
        emailOverride?: string;
      }
    | {
        mode: "paid_offline";
        method: "check" | "cash";
        checkNumber?: string;
        proofUrl?: string;
      },
): Promise<WorkOrderCompletionResult> {
  return authRequest<WorkOrderCompletionResult>(`/work-orders/${id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function uploadWorkOrderPaymentProof(
  token: string,
  id: string,
  file: File,
): Promise<{ url: string }> {
  const payload = new FormData();
  payload.append("file", file);
  return authRequest<{ url: string }>(`/work-orders/${id}/payment-proof`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  });
}

export async function sendWorkOrderReceipt(
  token: string,
  id: string,
  data:
    | { channel: "email"; email: string; saveToContact?: boolean }
    | { channel: "sms"; phone: string },
): Promise<{ email?: InvoiceEmailReceipt; text?: InvoiceTextReceipt }> {
  return authRequest<{ email?: InvoiceEmailReceipt; text?: InvoiceTextReceipt }>(
    `/work-orders/${id}/send-receipt`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function getPublicInvoiceView(token: string): Promise<{
  invoice: InvoiceItem;
  blocks: unknown;
}> {
  return authRequest<{ invoice: InvoiceItem; blocks: unknown }>(
    `/invoice-view/${encodeURIComponent(token)}`,
    { method: "GET" },
  );
}

export async function updateWorkOrder(
  token: string,
  id: string,
  data: Partial<ServiceTicketPayload> & {
    assignedUserRef?: string | null;
    assignedUserRefs?: string[];
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
  unscheduledTasks?: TaskItem[];
}

export async function geocodeMissingScheduleAddresses(
  token: string,
  addressIds: string[],
): Promise<{ updated: Array<{ addressId: string; lat: number; lng: number }> }> {
  return authRequest<{
    updated: Array<{ addressId: string; lat: number; lng: number }>;
  }>("/schedule/geocode-missing", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ addressIds }),
  });
}

export async function getScheduleQueue(
  token: string,
  opts?: { from?: string; to?: string; includeUndated?: boolean },
): Promise<ScheduleQueue> {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  if (opts?.includeUndated) params.set("includeUndated", "1");
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
  roles: string[];
  schedulable?: boolean;
  homeLocation: UserHomeLocation;
  weeklyHours: UserWeeklyHours;
  scheduleExceptions: ScheduleException[];
  serviceCities?: ServiceCity[];
  scheduleColor?: string;
  initials?: string;
}

export interface TechnicianListItem {
  _id: string;
  first_name: string;
  last_name: string;
  jobsOnDate: number;
}

export async function getTechnicians(
  token: string,
  options?: {
    search?: string;
    date?: string;
    excludeWorkOrderId?: string;
    /** Return every schedulable technician. Default search stays capped. */
    all?: boolean;
  },
): Promise<{ technicians: TechnicianListItem[] }> {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  if (options?.date) params.set("date", options.date);
  if (options?.excludeWorkOrderId) {
    params.set("excludeWorkOrderId", options.excludeWorkOrderId);
  }
  if (options?.all) params.set("all", "1");
  const qs = params.toString();
  return authRequest<{ technicians: TechnicianListItem[] }>(
    `/schedule/technicians${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function suggestServiceCities(
  token: string,
  query: string,
  state: string,
): Promise<{ suggestions: CitySuggestion[] }> {
  const params = new URLSearchParams({ q: query, state });
  return authRequest<{ suggestions: CitySuggestion[] }>(
    `/schedule/city-suggestions?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function resolveServiceCity(
  token: string,
  placeId: string,
  state: string,
): Promise<{ city: ServiceCity }> {
  const params = new URLSearchParams({ placeId, state });
  return authRequest<{ city: ServiceCity }>(
    `/schedule/city-details?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

/** A selectable map zone: a Census place plus its nearest share of unclaimed area. */
export interface CityZone {
  name: string;
  state: string;
  kind: "city" | "cdp";
  geoid: string;
  lat: number | null;
  lng: number | null;
}

export interface CityBoundaryCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: CityZone;
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
  }>;
}

export async function getCityBoundaries(
  token: string,
  state: string,
): Promise<CityBoundaryCollection> {
  const params = new URLSearchParams({ state });
  return authRequest<CityBoundaryCollection>(
    `/schedule/city-boundaries?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function resolveServiceCityAt(
  token: string,
  lat: number,
  lng: number,
  state: string,
): Promise<{ city: ServiceCity }> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    state,
  });
  return authRequest<{ city: ServiceCity }>(
    `/schedule/city-at-point?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getScheduleStaff(
  token: string,
  from: string,
  to: string,
  userId?: string,
): Promise<{
  staff: ScheduleStaffMember[];
  workOrders: WorkOrderListItem[];
  tasks: TaskItem[];
}> {
  const params = new URLSearchParams({ from, to });
  if (userId) params.set("userId", userId);
  return authRequest<{
    staff: ScheduleStaffMember[];
    workOrders: WorkOrderListItem[];
    tasks: TaskItem[];
  }>(`/schedule/staff?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface ScheduleTextResult {
  sent: boolean;
  body: string;
  phoneLast4: string | null;
  technicianName: string;
  jobCount: number;
  sid?: string;
}

export async function textTechnicianSchedule(
  token: string,
  data: { userId: string; date: string; send?: boolean },
): Promise<ScheduleTextResult> {
  return authRequest<ScheduleTextResult>("/schedule/text", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
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
  /** False when this date is outside the technician's working schedule. */
  available: boolean;
  fits: boolean;
  reason: string;
  driveSource: "google" | "haversine" | "none";
  driveFrom: "previousJob" | "home" | "unknown";
  driveFromLabel: string;
  driveKnown: boolean;
  /** True when the job's city is one of this technician's service cities. */
  inTerritory?: boolean;
}

export interface ScheduleRecommendation {
  userId: string;
  first_name: string;
  last_name: string;
  /** False when this date is outside the technician's working schedule. */
  available: boolean;
  reason: string;
}

export interface SlotTechnicianRecommendation {
  userId: string;
  first_name: string;
  last_name: string;
  /** False when this date is outside the technician's working schedule. */
  available: boolean;
  /** True when the requested window fits their hours and does not overlap another job. */
  fits: boolean;
  reason: string;
}

export interface RecommendedRouteDate {
  date: string;
  userId: string;
  first_name: string;
  last_name: string;
  initials?: string;
  scheduleColor?: string;
  distanceMiles: number;
  stopCount: number;
  closestStopCity: string;
  matchType?: "route" | "territory";
  territoryCity?: string;
}

export async function getRecommendedRouteDates(
  token: string,
  data: {
    startTime?: string;
    startBy?: string;
    estimatedMinutes?: number;
    addressRef?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    workOrderTypeRef?: string;
    excludeWorkOrderId?: string;
    maxMiles?: number;
  },
): Promise<{
  dates: RecommendedRouteDate[];
}> {
  return authRequest("/schedule/recommended-dates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function recommendTechnicianForSlot(
  token: string,
  data: {
    date: string;
    startTime?: string;
    startBy?: string;
    estimatedMinutes?: number;
    addressRef?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    workOrderTypeRef?: string;
    excludeWorkOrderId?: string;
  },
): Promise<{
  technicians: SlotTechnicianRecommendation[];
  recommendation: SlotTechnicianRecommendation | null;
}> {
  return authRequest("/schedule/technician-recommendation", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function getScheduleRecommendations(
  token: string,
  data: { date: string; workOrderIds: string[] },
): Promise<{
  date: string;
  recommendations: Array<{
    workOrderId: string;
    recommendation: ScheduleRecommendation | null;
    technicians: ScheduleRecommendation[];
  }>;
}> {
  return authRequest("/schedule/recommendations", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
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

export interface ScheduleStartOptions {
  isFirst: boolean;
  earliestStart: string | null;
  driveMinutes: number | null;
  driveFromLabel: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  warning: string | null;
  date: string;
  assignedUserRef: string;
}

export async function getScheduleStartOptions(
  token: string,
  workOrderId: string,
): Promise<ScheduleStartOptions> {
  const params = new URLSearchParams({ workOrderId });
  return authRequest(`/schedule/start-options?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function placeScheduleWorkOrder(
  token: string,
  data: {
    workOrderId: string;
    assignedUserRef: string;
    assignedUserRefs?: string[];
    date: string;
    scheduledStart?: string;
    estimatedMinutes?: number;
    insertIndex?: number;
    requirePreferred?: boolean;
  },
): Promise<{ workOrders: WorkOrderListItem[]; warnings: string[] }> {
  return authRequest(`/schedule/place`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export interface PreviewOptimalPlacementResult {
  insertIndex: number;
  scheduledStart: string;
  startTime: string;
  endTime: string;
  estimatedMinutes: number;
  warnings: string[];
}

export async function previewOptimalPlacement(
  token: string,
  data: {
    userId: string;
    date: string;
    addressRef?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    desiredStartTime?: string | null;
    desiredStartBy?: string | null;
    estimatedMinutes?: number;
    objective?: "time" | "distance";
    roundTrip?: boolean;
  },
): Promise<PreviewOptimalPlacementResult> {
  return authRequest<PreviewOptimalPlacementResult>(
    `/schedule/preview-optimal-placement`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function assignAndOptimizeTechnician(
  token: string,
  data: {
    workOrderId: string;
    userId: string;
    date: string;
    objective?: "time" | "distance";
    roundTrip?: boolean;
  },
): Promise<{ workOrder: WorkOrderListItem; warnings: string[] }> {
  return authRequest<{ workOrder: WorkOrderListItem; warnings: string[] }>(
    `/schedule/assign-and-optimize`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export interface ScheduleRouteStop {
  kind: "home" | "job";
  label: string;
  lat: number | null;
  lng: number | null;
  workOrderId?: string;
  scheduledStart?: string | null;
  arrival?: string | null;
  departure?: string | null;
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

export type RouteObjective = "time" | "distance";

export interface PlannedRoute {
  stops: ScheduleRouteStop[];
  route: {
    durationMinutes: number;
    distanceMeters: number;
    encodedPolyline?: string;
    legs: ScheduleRouteLeg[];
    source: "google" | "haversine";
  } | null;
  orderedWorkOrderIds: string[];
  warnings: string[];
}

export async function planScheduleRoute(
  token: string,
  data: {
    userId: string;
    date: string;
    workOrderIds: string[];
    roundTrip: boolean;
    objective: RouteObjective;
    optimize: boolean;
    lockedStops?: Array<{ workOrderId: string; arrival: string }>;
  },
): Promise<PlannedRoute> {
  return authRequest(`/schedule/route/plan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function applyScheduleRoute(
  token: string,
  data: {
    userId: string;
    date: string;
    orderedWorkOrderIds: string[];
    lockedStops?: Array<{ workOrderId: string; arrival: string }>;
  },
): Promise<{ workOrders: WorkOrderListItem[]; warnings: string[] }> {
  return authRequest(`/schedule/route/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function setScheduleRouteLock(
  token: string,
  data: { workOrderId: string; locked: boolean },
): Promise<WorkOrderListItem> {
  return authRequest(`/schedule/route/lock`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
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
  originalAmountCents?: number | null;
  discountCode?: string | null;
  discountCents?: number;
  taxRatePercent?: number;
  taxCents?: number;
  taxOverridden?: boolean;
  currency: string;
  status: InvoiceStatus;
  dueDate: string | null;
  issuedAt: string;
  paidAt: string | null;
  paymentProvider: "square" | "stripe" | "paypal" | null;
  offlinePayment?: OfflinePayment | null;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  hasPayLink: boolean;
  payTokenExpiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Present on GET /invoices list responses. */
  customerName?: string;
  /** Present on GET /invoices list responses. */
  contactName?: string;
  /** Present on GET /invoices/:id only. */
  customer?: InvoiceCustomerSummary | null;
  /** Present on GET /invoices/:id only. */
  serviceAddress?: InvoiceServiceAddress | null;
  /** Visible work-order notes, when the invoice is sourced from a work order. */
  workOrderNotes?: WorkOrderNote[];
}

export interface CreateInvoiceInput {
  sourceType: InvoiceSourceType;
  contractRef?: string;
  workOrderRef?: string;
  amountCents?: number;
  description?: string;
  dueDate?: string;
  allowPaidBypass?: boolean;
}

export async function getPendingPayments(
  token: string,
  params?: {
    search?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  invoices: InvoiceItem[];
  total?: number;
  page?: number;
  pageSize?: number;
}> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.pageSize != null) qs.set("pageSize", String(params.pageSize));
  const q = qs.toString();
  return authRequest<{
    invoices: InvoiceItem[];
    total?: number;
    page?: number;
    pageSize?: number;
  }>(`/invoices/pending-payments${q ? `?${q}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getInvoices(
  token: string,
  params?: {
    status?: string;
    customerRef?: string;
    contractRef?: string;
    workOrderRef?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  invoices: InvoiceItem[];
  total?: number;
  page?: number;
  pageSize?: number;
}> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.customerRef) qs.set("customerRef", params.customerRef);
  if (params?.contractRef) qs.set("contractRef", params.contractRef);
  if (params?.workOrderRef) qs.set("workOrderRef", params.workOrderRef);
  if (params?.search) qs.set("search", params.search);
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.pageSize != null) qs.set("pageSize", String(params.pageSize));
  const q = qs.toString();
  return authRequest<{
    invoices: InvoiceItem[];
    total?: number;
    page?: number;
    pageSize?: number;
  }>(`/invoices${q ? `?${q}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
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

export interface InvoiceTemplateItem {
  _id: string;
  name: string;
  isDefault: boolean;
  blocks: unknown[];
  createdAt: string;
  updatedAt: string;
}

export async function getDefaultInvoiceTemplate(
  token: string,
): Promise<{ template: InvoiceTemplateItem }> {
  return authRequest<{ template: InvoiceTemplateItem }>("/invoice-templates/default", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getInvoiceTemplates(
  token: string,
): Promise<{ templates: InvoiceTemplateItem[] }> {
  return authRequest<{ templates: InvoiceTemplateItem[] }>("/invoice-templates", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createInvoiceTemplate(
  token: string,
  data: { name: string; isDefault?: boolean; blocks?: unknown[] },
): Promise<{ template: InvoiceTemplateItem }> {
  return authRequest<{ template: InvoiceTemplateItem }>("/invoice-templates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateInvoiceTemplate(
  token: string,
  id: string,
  data: { name?: string; isDefault?: boolean; blocks?: unknown[] },
): Promise<{ template: InvoiceTemplateItem }> {
  return authRequest<{ template: InvoiceTemplateItem }>(`/invoice-templates/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteInvoiceTemplate(
  token: string,
  id: string,
): Promise<{ deletedId: string; defaultId: string }> {
  return authRequest<{ deletedId: string; defaultId: string }>(
    `/invoice-templates/${id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function uploadInvoiceTemplateImage(
  token: string,
  file: File,
): Promise<{ url: string }> {
  const payload = new FormData();
  payload.append("file", file);
  return authRequest<{ url: string }>("/invoice-templates/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
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
): Promise<{ payUrl: string; expiresAt?: string; invoice: InvoiceItem }> {
  return authRequest<{
    payUrl: string;
    expiresAt?: string;
    invoice: InvoiceItem;
  }>(`/invoices/${id}/pay-link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function markInvoicePaid(
  token: string,
  id: string,
): Promise<{ invoice: InvoiceItem }> {
  return authRequest<{ invoice: InvoiceItem }>(`/invoices/${id}/mark-paid`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function reopenInvoice(
  token: string,
  id: string,
): Promise<{ invoice: InvoiceItem }> {
  return authRequest<{ invoice: InvoiceItem }>(`/invoices/${id}/reopen`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateInvoiceTax(
  token: string,
  id: string,
  data: { taxCents?: number; taxRatePercent?: number },
): Promise<{ invoice: InvoiceItem }> {
  return authRequest<{ invoice: InvoiceItem }>(`/invoices/${id}/tax`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export interface BulkInvoiceStatusResult {
  updated: InvoiceItem[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; message: string }[];
}

export async function bulkUpdateInvoiceStatus(
  token: string,
  data: { ids: string[]; paid: boolean },
): Promise<BulkInvoiceStatusResult> {
  return authRequest<BulkInvoiceStatusResult>("/invoices/bulk-status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export type CheckoutItemKind = "invoice" | "work_order";

export interface CheckoutItem {
  id: string;
  kind: CheckoutItemKind;
  number: string;
  description: string;
  amountCents: number;
  status: string;
  sourceType?: string;
}

export interface CheckoutCart {
  customerLabel: string;
  items: CheckoutItem[];
  totalCents: number;
  invoiceOnly?: boolean;
}

export type CheckoutConfirmStatus = "paid" | "failed" | "pending";

export interface CheckoutConfirmInvoice {
  _id: string;
  number: string;
  description: string;
  amountCents: number;
  status: string;
  sourceType?: string;
}

export async function confirmCheckoutPayment(data: {
  invoiceId?: string;
  transactionId?: string;
  orderId?: string;
}): Promise<{
  status: CheckoutConfirmStatus;
  invoices: CheckoutConfirmInvoice[];
}> {
  return authRequest<{
    status: CheckoutConfirmStatus;
    invoices: CheckoutConfirmInvoice[];
  }>("/checkout/confirm", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getCheckoutKeyByPayCode(code: string): Promise<string> {
  const data = await authRequest<{ checkoutKey?: string }>(
    `/checkout/code/${encodeURIComponent(code)}`,
    { method: "GET" },
  );
  const checkoutKey = data.checkoutKey?.trim() ?? "";
  if (!checkoutKey) {
    throw new ApiError("Checkout link not found.", 404);
  }
  return checkoutKey;
}

export async function getCheckoutByKey(key: string): Promise<CheckoutCart> {
  return authRequest<CheckoutCart>(`/checkout/${encodeURIComponent(key)}`, {
    method: "GET",
  });
}

export async function startCheckoutByKey(
  key: string,
  data: {
    invoiceIds: string[];
    workOrderIds: string[];
    discountCode?: string;
  },
): Promise<{ url: string }> {
  return authRequest<{ url: string }>(
    `/checkout/${encodeURIComponent(key)}/session`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

export interface CheckoutDiscountPreview {
  code: string;
  label: string;
  mode: "percent" | "amount";
  discountCents: number;
  subtotalCents: number;
  eligibleCents: number;
  totalCents: number;
}

export async function previewCheckoutDiscountByKey(
  key: string,
  data: {
    code: string;
    invoiceIds: string[];
    workOrderIds: string[];
  },
): Promise<CheckoutDiscountPreview> {
  return authRequest<CheckoutDiscountPreview>(
    `/checkout/${encodeURIComponent(key)}/discount`,
    {
      method: "POST",
      body: JSON.stringify({
        discountCode: data.code,
        invoiceIds: data.invoiceIds,
        workOrderIds: data.workOrderIds,
      }),
    },
  );
}

export async function getMyCheckout(token: string): Promise<CheckoutCart> {
  return authRequest<CheckoutCart>("/checkout/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function startMyCheckoutSession(
  token: string,
  data: {
    invoiceIds: string[];
    workOrderIds: string[];
    discountCode?: string;
  },
): Promise<{ url: string }> {
  return authRequest<{ url: string }>("/checkout/me/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function previewMyCheckoutDiscount(
  token: string,
  data: {
    code: string;
    invoiceIds: string[];
    workOrderIds: string[];
  },
): Promise<CheckoutDiscountPreview> {
  return authRequest<CheckoutDiscountPreview>("/checkout/me/discount", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      discountCode: data.code,
      invoiceIds: data.invoiceIds,
      workOrderIds: data.workOrderIds,
    }),
  });
}

export type PortalContractStanding = "active" | "due_soon" | "expired";

export interface PortalContract {
  _id: string;
  templateLabel: string;
  contractType: string | null;
  standing: PortalContractStanding;
  inGoodStanding: boolean;
  renewalDueDate: string | null;
  durationMonths: number;
  address: {
    label: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
}

export interface PortalAppointment {
  _id: string;
  number: string;
  descPerform: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  date: string | null;
  tech: string;
  addressLabel: string;
  completed: boolean;
  canceled: boolean;
}

export interface PortalInvoice {
  _id: string;
  number: string;
  status: InvoiceStatus;
  amountCents: number;
  issuedAt: string;
  paidAt: string | null;
}

export interface PortalHome {
  contracts: PortalContract[];
  appointments: {
    upcoming: PortalAppointment[];
    recent: PortalAppointment[];
  };
  balance: CheckoutCart;
  invoices: PortalInvoice[];
  customers: PortalCustomer[];
}

export interface PortalAddress {
  _id: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
}

export interface PortalContact {
  _id: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
}

export interface PortalCustomer {
  _id: string;
  accountName: string;
  addresses: PortalAddress[];
  contacts: PortalContact[];
}

export async function getPortalHome(token: string): Promise<PortalHome> {
  return authRequest<PortalHome>("/portal/home", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updatePortalAddress(
  token: string,
  addressId: string,
  data: {
    label?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    isPrimary?: boolean;
  },
): Promise<{ address: PortalAddress }> {
  return authRequest<{ address: PortalAddress }>(
    `/portal/addresses/${addressId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function updatePortalContact(
  token: string,
  contactId: string,
  data: {
    first?: string;
    last?: string;
    phone?: string;
    email?: string;
    label?: string;
    isPrimary?: boolean;
  },
): Promise<{ contact: PortalContact }> {
  return authRequest<{ contact: PortalContact }>(
    `/portal/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deletePortalAddress(
  token: string,
  addressId: string,
): Promise<void> {
  await authRequest<void>(`/portal/addresses/${addressId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createPortalAddress(
  token: string,
  data: {
    label?: string;
    address: string;
    city?: string;
    state?: string;
    zip?: string;
    isPrimary?: boolean;
  },
): Promise<{ address: PortalAddress; customerId: string }> {
  return authRequest<{ address: PortalAddress; customerId: string }>(
    "/portal/addresses",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deletePortalContact(
  token: string,
  contactId: string,
): Promise<void> {
  await authRequest<void>(`/portal/contacts/${contactId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createPortalContact(
  token: string,
  data: {
    first: string;
    last?: string;
    phone?: string;
    email?: string;
    label?: string;
    isPrimary?: boolean;
  },
): Promise<{ contact: PortalContact; customerId: string }> {
  return authRequest<{ contact: PortalContact; customerId: string }>(
    "/portal/contacts",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function getCustomerCheckoutLink(
  token: string,
  customerId: string,
): Promise<{ checkoutUrl: string; invoiceId?: string; totalCents?: number }> {
  return authRequest<{ checkoutUrl: string; invoiceId?: string; totalCents?: number }>(
    `/customers/${customerId}/checkout-link`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
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
  agreementBody?: string;
  productDiscounts?: ProductDiscounts;
  contractTemplateRef?: string | null;
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
  agreementBody?: string;
  productDiscounts?: ProductDiscounts;
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
// Discount codes
// ---------------------------------------------------------------------------

export type DiscountMode = "percent" | "amount";
export type DiscountAppliesTo = "work_order" | "contract";

export interface DiscountCodeItem {
  _id: string;
  code: string;
  label: string;
  mode: DiscountMode;
  value: number;
  active: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxRedemptionsPerCustomer: number | null;
  minSubtotalCents: number | null;
  appliesTo: DiscountAppliesTo[];
  createdAt: string;
  updatedAt: string;
}

export type DiscountCodeWritePayload = {
  code: string;
  label?: string;
  mode: DiscountMode;
  value: number;
  active?: boolean;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
  maxRedemptionsPerCustomer?: number | null;
  minSubtotalCents?: number | null;
  appliesTo?: DiscountAppliesTo[];
};

export async function getDiscountCodes(
  token: string,
  opts?: { search?: string },
): Promise<{ discountCodes: DiscountCodeItem[] }> {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  const qs = params.toString();
  return authRequest<{ discountCodes: DiscountCodeItem[] }>(
    `/discount-codes${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createDiscountCode(
  token: string,
  data: DiscountCodeWritePayload,
): Promise<{ discountCode: DiscountCodeItem }> {
  return authRequest<{ discountCode: DiscountCodeItem }>("/discount-codes", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateDiscountCode(
  token: string,
  id: string,
  data: Partial<DiscountCodeWritePayload>,
): Promise<{ discountCode: DiscountCodeItem }> {
  return authRequest<{ discountCode: DiscountCodeItem }>(
    `/discount-codes/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteDiscountCode(
  token: string,
  id: string,
): Promise<void> {
  await authRequest<void>(`/discount-codes/${id}`, {
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
  workOrderTypeRef?: string | null;
  workOrderType?: { _id: string; label: string } | null;
  descPerform: string;
  laborHours: number;
  date: string | null;
  tech: string;
  parts: WorkOrderPart[];
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerState: string;
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
  totalAgreements?: number;
  laborOverridden: boolean;
  miscExp: number;
  subtotal: number;
  shipping: number;
  taxRate?: number;
  tax?: number;
  taxOverridden?: boolean;
  total: number;
  signatureDataUrl?: string;
  signedAt?: string | null;
  signedByName?: string;
  contractRef?: string | null;
  contractDiscount?: TicketContractDiscount | null;
  createdAt: string;
  updatedAt: string;
}

export type EstimateStatusGroup = "active" | "awarded" | "lost";

export async function getEstimates(
  token: string,
  opts?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: EstimateStatus;
    statusGroup?: EstimateStatusGroup;
    customerId?: number;
  },
): Promise<{
  estimates: EstimateItem[];
  total: number;
  page: number;
  pageSize: number;
  stats?: { total: number; active: number; awarded: number; lost: number };
}> {
  const params = new URLSearchParams();
  if (opts?.page != null) params.set("page", String(opts.page));
  if (opts?.pageSize != null) params.set("pageSize", String(opts.pageSize));
  if (opts?.search) params.set("search", opts.search);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.statusGroup) params.set("statusGroup", opts.statusGroup);
  if (opts?.customerId != null) params.set("customerId", String(opts.customerId));
  return authRequest<{
    estimates: EstimateItem[];
    total: number;
    page: number;
    pageSize: number;
    stats?: { total: number; active: number; awarded: number; lost: number };
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

export interface EstimateTemplateItem {
  _id: string;
  name: string;
  descPerform: string;
  laborHours: number;
  parts: WorkOrderPart[];
  productCount: number;
  isDefault: boolean;
  createdBy: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EstimateTemplatePayload = {
  name: string;
  descPerform?: string;
  laborHours?: number;
  parts?: WorkOrderPart[];
};

export async function getEstimateTemplates(
  token: string,
): Promise<{ templates: EstimateTemplateItem[] }> {
  return authRequest<{ templates: EstimateTemplateItem[] }>(
    "/estimate-templates",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getEstimateTemplate(
  token: string,
  id: string,
): Promise<{ template: EstimateTemplateItem }> {
  return authRequest<{ template: EstimateTemplateItem }>(
    `/estimate-templates/${id}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createEstimateTemplate(
  token: string,
  data: EstimateTemplatePayload,
): Promise<{ template: EstimateTemplateItem }> {
  return authRequest<{ template: EstimateTemplateItem }>("/estimate-templates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateEstimateTemplate(
  token: string,
  id: string,
  data: Partial<EstimateTemplatePayload>,
): Promise<{ template: EstimateTemplateItem }> {
  return authRequest<{ template: EstimateTemplateItem }>(
    `/estimate-templates/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function setEstimateTemplateDefault(
  token: string,
  id: string,
  isDefault = true,
): Promise<{ template: EstimateTemplateItem }> {
  return authRequest<{ template: EstimateTemplateItem }>(
    `/estimate-templates/${id}/default`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isDefault }),
    },
  );
}

export async function deleteEstimateTemplate(
  token: string,
  id: string,
): Promise<void> {
  await authRequest<Record<string, never>>(`/estimate-templates/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface FinancialsOwnerOption {
  id: string;
  name: string;
}

export interface FinancialsOwnersResponse {
  canChoose: boolean;
  ownerId: string | null;
  owners: FinancialsOwnerOption[];
}

export async function getFinancialsOwners(
  token: string,
): Promise<FinancialsOwnersResponse> {
  return authRequest<FinancialsOwnersResponse>("/financials/owners", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface FinancialsSummary {
  from: string | null;
  to: string | null;
  ownerScoped?: boolean;
  ownerId?: string | null;
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
    openCents: number;
    completedCount: number;
    unbilledCents: number;
    laborHours: number;
    completedPaidCount: number;
    completedPaidCents: number;
    pendingPaymentCount: number;
    pendingPaymentCents: number;
  };
  estimates: {
    count: number;
    byStatus: Record<string, { count: number; cents: number }>;
  };
}

export async function getFinancialsSummary(
  token: string,
  opts?: { from?: string; to?: string; owner?: string },
): Promise<FinancialsSummary> {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  if (opts?.owner) params.set("owner", opts.owner);
  const qs = params.toString();
  return authRequest<FinancialsSummary>(
    `/financials/summary${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export type FinancialFilterType =
  | "invoiced"
  | "paid"
  | "outstanding"
  | "past_due"
  | "open_work_orders"
  | "unbilled_work"
  | "completed_paid"
  | "pending_payment"
  | "estimates";

export interface FinancialRecordItem {
  _id: string;
  recordType: "invoice" | "work_order" | "estimate";
  number: string;
  customerName: string;
  date: string;
  dueDate?: string | null;
  paidAt?: string | null;
  status: string;
  amountCents?: number;
  total?: number;
  paid?: boolean;
  laborHours?: number;
  sourceType?: string;
  description?: string;
  detailUrl: string;
}

export interface FinancialRecordsResponse {
  type: FinancialFilterType;
  records: FinancialRecordItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getFinancialsRecords(
  token: string,
  opts: {
    type: FinancialFilterType;
    from?: string;
    to?: string;
    owner?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: "asc" | "desc";
  },
): Promise<FinancialRecordsResponse> {
  const params = new URLSearchParams();
  params.set("type", opts.type);
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.owner) params.set("owner", opts.owner);
  if (opts.search) params.set("search", opts.search);
  if (opts.page != null) params.set("page", String(opts.page));
  if (opts.pageSize != null) params.set("pageSize", String(opts.pageSize));
  if (opts.sortBy) params.set("sortBy", opts.sortBy);
  if (opts.sortDir) params.set("sortDir", opts.sortDir);
  const qs = params.toString();
  return authRequest<FinancialRecordsResponse>(
    `/financials/records${qs ? `?${qs}` : ""}`,
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

export const JOB_ROLE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "phone",
  "email",
] as const;

export type JobRoleFieldType = (typeof JOB_ROLE_FIELD_TYPES)[number];

export interface JobRoleField {
  key: string;
  label: string;
  type: JobRoleFieldType;
  required: boolean;
  options: string[];
  helpText: string;
  order: number;
}

export interface JobRoleItem {
  _id: string;
  slug: string;
  label: string;
  description: string;
  color: string;
  isSystem: boolean;
  capabilities: UserCapabilities;
  /** Stored on the role. The staff home no longer follows this value. */
  dashboardView: "default" | "todo";
  fields: JobRoleField[];
  createdAt?: string;
  updatedAt?: string;
}

export type JobRoleWrite = {
  label: string;
  description?: string;
  color?: string;
  capabilities?: UserCapabilities;
  dashboardView?: "default" | "todo";
  fields?: JobRoleField[];
};

export async function getJobRoles(
  token: string,
): Promise<{ jobRoles: JobRoleItem[] }> {
  return authRequest<{ jobRoles: JobRoleItem[] }>("/job-roles", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createJobRole(
  token: string,
  data: JobRoleWrite,
): Promise<{ jobRole: JobRoleItem }> {
  return authRequest<{ jobRole: JobRoleItem }>("/job-roles", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateJobRole(
  token: string,
  id: string,
  data: Partial<JobRoleWrite>,
): Promise<{ jobRole: JobRoleItem }> {
  return authRequest<{ jobRole: JobRoleItem }>(`/job-roles/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteJobRole(
  token: string,
  id: string,
  force = false,
): Promise<{ message: string }> {
  const query = force ? "?force=1" : "";
  return authRequest<{ message: string }>(`/job-roles/${id}${query}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Twilio accounts (Control Panel)
// ---------------------------------------------------------------------------

export type TwilioRuntimeEnvironment = "development" | "production";
export type TwilioCredentialPair = "live" | "test";

export interface TwilioPhoneLine {
  phoneNumber: string;
  label: string;
  twilioFriendlyName: string;
  incomingSid: string;
  sms: boolean;
  mms: boolean;
  voice: boolean;
}

export function formatTwilioLine(
  label: string | null | undefined,
  phone: string,
): string {
  const trimmed = label?.trim() ?? "";
  if (trimmed && phone) return `${trimmed} · ${phone}`;
  return phone || trimmed;
}

export interface TwilioAccountItem {
  _id: string;
  accountSid: string;
  friendlyName: string;
  phoneNumbers: TwilioPhoneLine[];
  isActive: boolean;
  sayVoice: string;
  environment: TwilioRuntimeEnvironment;
  credentialsInUse: TwilioCredentialPair;
  hasAuthToken: boolean;
  testAccountSid: string | null;
  hasTestAuthToken: boolean;
  browserCalling: boolean;
  voicePublicBaseUrl: string;
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
  phoneNumbers?: { phoneNumber: string; label?: string }[];
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

export async function enableBrowserCalling(
  token: string,
  accountId: string,
  publicApiUrl?: string,
): Promise<{ account: TwilioAccountItem }> {
  return authRequest<{ account: TwilioAccountItem }>(
    `/twilio-accounts/${accountId}/voice/enable`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(publicApiUrl ? { publicApiUrl } : {}),
    },
  );
}

export async function previewTwilioNumbers(
  token: string,
  data: { accountSid: string; authToken: string },
): Promise<{ phoneNumbers: TwilioPhoneLine[] }> {
  return authRequest<{ phoneNumbers: TwilioPhoneLine[] }>(
    "/twilio-accounts/preview-numbers",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function syncTwilioAccountNumbers(
  token: string,
  id: string,
): Promise<{ account: TwilioAccountItem; numbersSyncError: string | null }> {
  return authRequest<{
    account: TwilioAccountItem;
    numbersSyncError: string | null;
  }>(`/twilio-accounts/${id}/sync-numbers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createTwilioAccount(
  token: string,
  data: TwilioAccountInput,
): Promise<{ account: TwilioAccountItem; numbersSyncError?: string | null }> {
  return authRequest<{
    account: TwilioAccountItem;
    numbersSyncError?: string | null;
  }>("/twilio-accounts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateTwilioAccount(
  token: string,
  id: string,
  data: Partial<TwilioAccountInput>,
): Promise<{ account: TwilioAccountItem; numbersSyncError?: string | null }> {
  return authRequest<{
    account: TwilioAccountItem;
    numbersSyncError?: string | null;
  }>(`/twilio-accounts/${id}`, {
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
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  isActive: boolean;
  autoAcknowledge?: boolean;
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
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  isActive?: boolean;
  autoAcknowledge?: boolean;
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

export async function testEmailAccountImap(
  token: string,
  id: string,
): Promise<{ message: string; mailbox: string }> {
  return authRequest<{ message: string; mailbox: string }>(
    `/email-accounts/${id}/imap-test`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export type MailboxFolder = "inbox" | "sent";

export interface MailboxAddress {
  name: string;
  address: string;
}

export interface MailboxCustomerLink {
  id: string;
  name: string;
}

export interface MailboxMessageSummary {
  uid: number;
  subject: string;
  from: MailboxAddress[];
  to: MailboxAddress[];
  cc: MailboxAddress[];
  date: string | null;
  seen: boolean;
  snippet: string;
  messageId: string;
  inReplyTo: string;
  threadKey: string;
  messageKey: string;
  assignees: string[];
  customer: MailboxCustomerLink | null;
  archived?: boolean;
}

export interface MailboxAttachmentMeta {
  filename: string;
  size: number;
  contentType: string;
}

export type MailboxReplyMode = "reply" | "replyAll" | "forward";

export interface MailboxMessageDetail extends MailboxMessageSummary {
  text: string;
  html: string;
  attachments: MailboxAttachmentMeta[];
  references: string[];
}

export interface MailboxThreadMessage {
  source: "imap" | "crm";
  folder: MailboxFolder;
  uid: number | null;
  subject: string;
  from: MailboxAddress[];
  to: MailboxAddress[];
  cc: MailboxAddress[];
  date: string | null;
  seen: boolean;
  snippet: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  text: string;
  html: string;
  displayText: string;
  displayHtml: string;
  attachments: MailboxAttachmentMeta[];
  messageKey: string;
  assignees: string[];
  customer: MailboxCustomerLink | null;
  archived?: boolean;
}

export async function locateMailboxMessage(
  token: string,
  accountId: string,
  messageId: string,
): Promise<{ folder: MailboxFolder; uid: number }> {
  const params = new URLSearchParams({ messageId });
  return authRequest<{ folder: MailboxFolder; uid: number }>(
    `/email-mailbox/${accountId}/locate?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getMailboxMessages(
  token: string,
  accountId: string,
  folder: MailboxFolder,
  limit = 50,
): Promise<{ folder: MailboxFolder; messages: MailboxMessageSummary[] }> {
  const params = new URLSearchParams({
    folder,
    limit: String(limit),
  });
  return authRequest<{ folder: MailboxFolder; messages: MailboxMessageSummary[] }>(
    `/email-mailbox/${accountId}/messages?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getMailboxThread(
  token: string,
  accountId: string,
  uid: number,
  folder: MailboxFolder,
): Promise<{ folder: MailboxFolder; uid: number; messages: MailboxThreadMessage[] }> {
  const params = new URLSearchParams({ folder });
  return authRequest<{
    folder: MailboxFolder;
    uid: number;
    messages: MailboxThreadMessage[];
  }>(`/email-mailbox/${accountId}/messages/${uid}/thread?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMailboxMessage(
  token: string,
  accountId: string,
  uid: number,
  folder: MailboxFolder,
): Promise<{ folder: MailboxFolder; message: MailboxMessageDetail }> {
  const params = new URLSearchParams({ folder });
  return authRequest<{ folder: MailboxFolder; message: MailboxMessageDetail }>(
    `/email-mailbox/${accountId}/messages/${uid}?${params.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function markMailboxMessageSeen(
  token: string,
  accountId: string,
  uid: number,
  folder: MailboxFolder,
): Promise<{ seen: true }> {
  const params = new URLSearchParams({ folder });
  return authRequest<{ seen: true }>(
    `/email-mailbox/${accountId}/messages/${uid}/seen?${params.toString()}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function replyToMailboxMessage(
  token: string,
  accountId: string,
  uid: number,
  body: {
    folder: MailboxFolder;
    mode: MailboxReplyMode;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    html: string;
    useBrandTemplate?: boolean;
  },
): Promise<{ sent: true; savedToSent: boolean }> {
  return authRequest<{ sent: true; savedToSent: boolean }>(
    `/email-mailbox/${accountId}/messages/${uid}/reply`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );
}

export async function setMailboxAssignees(
  token: string,
  accountId: string,
  uid: number,
  body: { folder: MailboxFolder; userIds: string[] },
): Promise<{ assignees: string[]; messageKey: string }> {
  return authRequest<{ assignees: string[]; messageKey: string }>(
    `/email-mailbox/${accountId}/messages/${uid}/assignees`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );
}

export async function setMailboxMessageArchived(
  token: string,
  accountId: string,
  uid: number,
  body: { folder: MailboxFolder; archived: boolean },
): Promise<{ archived: boolean; messageKey: string }> {
  return authRequest<{ archived: boolean; messageKey: string }>(
    `/email-mailbox/${accountId}/messages/${uid}/archive`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
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

export interface TaxSettingsItem {
  ratePercent: number;
}

export async function getTaxSettings(
  token: string,
): Promise<{ settings: TaxSettingsItem }> {
  return authRequest<{ settings: TaxSettingsItem }>("/tax-settings", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveTaxSettings(
  token: string,
  data: { ratePercent: number },
): Promise<{ settings: TaxSettingsItem; updatedCount: number }> {
  return authRequest<{ settings: TaxSettingsItem; updatedCount: number }>(
    "/tax-settings",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export interface ServiceAreaCityItem {
  name: string;
}

export interface ServiceAreaItem {
  id: string;
  name: string;
  cities: ServiceAreaCityItem[];
}

export interface ServiceAreaInput {
  name: string;
  cities: ServiceAreaCityItem[];
}

export async function getServiceAreas(
  token: string,
): Promise<{ areas: ServiceAreaItem[] }> {
  return authRequest<{ areas: ServiceAreaItem[] }>("/service-areas", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveServiceAreas(
  token: string,
  areas: ServiceAreaInput[],
): Promise<{ areas: ServiceAreaItem[] }> {
  return authRequest<{ areas: ServiceAreaItem[] }>("/service-areas", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ areas }),
  });
}

// ---------------------------------------------------------------------------
// Cloudinary credentials and public image assets
// ---------------------------------------------------------------------------

export interface XaiCredentialsItem {
  _id: string;
  model: string;
  isActive: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function getXaiCredentials(
  token: string,
): Promise<{ credentials: XaiCredentialsItem | null }> {
  return authRequest("/xai-credentials", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveXaiCredentials(
  token: string,
  data: { apiKey?: string; model?: string; isActive?: boolean },
): Promise<{ credentials: XaiCredentialsItem }> {
  return authRequest("/xai-credentials", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteXaiCredentials(token: string): Promise<{ message: string }> {
  return authRequest("/xai-credentials", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface XaiModelChoice {
  id: string;
  aliases: string[];
}

export async function listXaiModels(
  token: string,
  data: { apiKey?: string } = {},
): Promise<{ models: XaiModelChoice[] }> {
  return authRequest("/xai-credentials/models", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function testXaiCredentials(
  token: string,
  data: { apiKey?: string; model?: string },
): Promise<{ ok: boolean; message: string }> {
  return authRequest("/xai-credentials/test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function rateCallTranscript(
  token: string,
  communicationId: string,
  data: { stars: number; comment?: string },
): Promise<{ rating: { stars: number; comment: string } }> {
  return authRequest(`/inboxes/messages/${communicationId}/transcript-rating`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function dismissCallTaskPrompt(
  token: string,
  communicationId: string,
): Promise<{ dismissed: boolean }> {
  return authRequest(`/inboxes/messages/${communicationId}/task-prompt/dismiss`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}

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

// ---------------------------------------------------------------------------
// Quo credentials
// ---------------------------------------------------------------------------

export interface QuoCredentialsItem {
  _id: string;
  label?: string;
  isActive: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuoCredentialsInput {
  apiKey?: string;
  label?: string;
  isActive?: boolean;
}

export async function getQuoCredentials(
  token: string,
): Promise<{ credentials: QuoCredentialsItem | null }> {
  return authRequest<{ credentials: QuoCredentialsItem | null }>(
    "/quo-credentials",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function saveQuoCredentials(
  token: string,
  data: QuoCredentialsInput,
): Promise<{ credentials: QuoCredentialsItem }> {
  return authRequest<{ credentials: QuoCredentialsItem }>(
    "/quo-credentials",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function deleteQuoCredentials(
  token: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/quo-credentials", {
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

export async function getTwilioResponseSettings(
  token: string,
): Promise<{ missedCallText: string }> {
  return authRequest<{ missedCallText: string }>("/twilio-response-settings", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveTwilioResponseSettings(
  token: string,
  missedCallText: string,
): Promise<{ missedCallText: string }> {
  return authRequest<{ missedCallText: string }>("/twilio-response-settings", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ missedCallText }),
  });
}

export interface ContactFormSubmissionItem {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  source: "website" | "mailbox-import";
  readAt: string | null;
  createdAt: string;
}

export async function getContactFormSubmissions(
  token: string,
  params: {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    unread?: boolean;
  } = {},
): Promise<{
  submissions: ContactFormSubmissionItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.unread) search.set("unread", "true");
  const query = search.toString();
  return authRequest(
    `/contact-submissions${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function markContactFormSubmissionRead(
  token: string,
  id: string,
): Promise<{ submission: ContactFormSubmissionItem }> {
  return authRequest(`/contact-submissions/${id}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function importContactFormSubmissions(
  token: string,
): Promise<{ imported: number; skipped: number }> {
  return authRequest("/contact-submissions/import", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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
  offerContractTemplateId?: string | null;
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
  offerContractTemplateId?: string | null;
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
  customerRef: string | null;
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
  ourNumberLabel: string | null;
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
  ourNumberLabel: string | null;
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
  readAt: string | null;
  readBy: {
    _id: string;
    first_name: string;
    last_name: string;
  } | null;
  contact: {
    _id: string;
    first: string;
    last: string;
    phone: string;
    label: string;
    customerRef: string | null;
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
  devTunnelUrl: string | null;
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

export interface InvoiceMessageDefaults {
  emailTemplateId: string | null;
  smsTemplateId: string | null;
}

export async function getInvoiceMessageDefaults(
  token: string,
): Promise<InvoiceMessageDefaults> {
  return authRequest<InvoiceMessageDefaults>(
    "/message-templates/invoice-defaults",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function saveInvoiceMessageDefaults(
  token: string,
  data: {
    emailTemplateId?: string | null;
    smsTemplateId?: string | null;
  },
): Promise<InvoiceMessageDefaults> {
  return authRequest<InvoiceMessageDefaults>(
    "/message-templates/invoice-defaults",
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
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
    invoiceId?: string;
    body: string;
    contactId?: string;
    renewalYear?: number;
    renewalMonth?: number;
    includePaymentLink?: boolean;
    offerContractTemplateId?: string | null;
  },
): Promise<MessagingPreviewResult> {
  return authRequest<MessagingPreviewResult>("/messaging/preview", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export type ScheduledMessageStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed";

export interface ScheduledMessageItem {
  _id: string;
  contactIds: string[];
  recipientCount: number;
  body: string;
  fromNumber: string;
  mediaUrls: string[];
  twilioAccountRef: string | null;
  accountFriendlyName: string | null;
  includePaymentLink: boolean;
  scheduledAt: string;
  status: ScheduledMessageStatus;
  summary: {
    total: number;
    sent: number;
    failed: number;
  } | null;
  errorMessage: string | null;
  cancelledAt: string | null;
  createdByUserRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function scheduleMessagingMessages(
  token: string,
  data: {
    contactIds: string[];
    body?: string;
    templateId?: string;
    twilioAccountId?: string;
    fromNumber?: string;
    mediaUrls?: string[];
    renewalYear?: number;
    renewalMonth?: number;
    includePaymentLink?: boolean;
    invoiceId?: string;
    expectedAmountCents?: number;
    offerContractTemplateId?: string | null;
    offerContractOverrides?: {
      contactId: string;
      contractTemplateId: string | null;
    }[];
    scheduledAt: string;
  },
): Promise<{ scheduled: ScheduledMessageItem }> {
  return authRequest<{ scheduled: ScheduledMessageItem }>(
    "/messaging/schedule",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function getScheduledMessages(
  token: string,
  options?: {
    status?: ScheduledMessageStatus | "all";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  scheduled: ScheduledMessageItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    scheduled: ScheduledMessageItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/messaging/scheduled${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function rescheduleMessagingMessages(
  token: string,
  id: string,
  scheduledAt: string,
): Promise<{ scheduled: ScheduledMessageItem }> {
  return authRequest<{ scheduled: ScheduledMessageItem }>(
    `/messaging/scheduled/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scheduledAt }),
    },
  );
}

export async function cancelScheduledMessage(
  token: string,
  id: string,
): Promise<{ scheduled: ScheduledMessageItem }> {
  return authRequest<{ scheduled: ScheduledMessageItem }>(
    `/messaging/scheduled/${id}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function sendMessagingMessages(
  token: string,
  data: {
    invoiceId?: string;
    expectedAmountCents?: number;
    contactIds: string[];
    body?: string;
    templateId?: string;
    threadId?: string;
    twilioAccountId?: string;
    fromNumber?: string;
    mediaUrls?: string[];
    renewalYear?: number;
    renewalMonth?: number;
    includePaymentLink?: boolean;
    offerContractTemplateId?: string | null;
    offerContractOverrides?: {
      contactId: string;
      contractTemplateId: string | null;
    }[];
    /** Replaces the contact's phone number for a single-contact send. */
    toOverride?: string;
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

export type VoiceAccessToken = {
  token: string;
  identity: string;
  twilioAccountId: string;
  accountSid: string;
  friendlyName: string;
  expiresIn: number;
};

export async function getVoiceToken(
  token: string,
  twilioAccountId?: string,
): Promise<VoiceAccessToken> {
  const params = new URLSearchParams();
  if (twilioAccountId) params.set("twilioAccountId", twilioAccountId);
  const qs = params.toString();
  return authRequest(`/voice/token${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getVoiceTokens(
  token: string,
): Promise<{ tokens: VoiceAccessToken[] }> {
  return authRequest("/voice/tokens", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function sendVoicePresence(
  token: string,
  accountSids: string[],
): Promise<{ ok: boolean; lastSeenAt: string }> {
  return authRequest("/voice/presence", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountSids }),
  });
}

export async function clearVoicePresence(
  token: string,
  keepalive = false,
  before?: string | null,
): Promise<void> {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  const qs = params.toString();
  await authRequest(`/voice/presence${qs ? `?${qs}` : ""}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    keepalive,
  });
}

export async function startVoiceCall(
  token: string,
  data: {
    contactId?: string;
    phone?: string;
    conversationId?: string;
    twilioAccountId?: string;
    fromNumber?: string;
  },
): Promise<{
  intentId: string;
  conversationId: string;
  twilioAccountId: string;
  fromNumber: string;
  toNumber: string;
}> {
  return authRequest("/voice/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function getMessagingCommunications(
  token: string,
  options?: {
    twilioAccountId?: string;
    accountSid?: string;
    customerId?: string;
    contactId?: string;
    channel?: CommunicationChannel | "sms,mms" | "all";
    direction?: CommunicationDirection;
    sendSource?: "wizard";
    status?: "sent" | "failed";
    from?: string;
    to?: string;
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
  if (options?.sendSource) params.set("sendSource", options.sendSource);
  if (options?.status) params.set("status", options.status);
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
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
    unread?: boolean;
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
  if (options?.unread) params.set("unread", "1");
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

export async function markMessagingThreadRead(
  token: string,
  threadId: string,
): Promise<{ thread: MessageThreadItem }> {
  return authRequest<{ thread: MessageThreadItem }>(
    `/messaging/threads/${threadId}/read`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
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
// Work order types (Control Panel catalog)
// ---------------------------------------------------------------------------

export interface WorkOrderTypeTechnician {
  _id: string;
  first_name: string;
  last_name: string;
}

export interface WorkOrderTypeItem {
  _id: string;
  label: string;
  slug: string;
  qualifiedUserRefs: string[];
  qualifiedUsers: WorkOrderTypeTechnician[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderTypeInput {
  label: string;
  qualifiedUserRefs?: string[];
}

export async function getWorkOrderTypes(
  token: string,
  options?: { includeDeleted?: boolean },
): Promise<{ types: WorkOrderTypeItem[] }> {
  const params = options?.includeDeleted ? "?includeDeleted=1" : "";
  return authRequest<{ types: WorkOrderTypeItem[] }>(
    `/work-order-types${params}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createWorkOrderType(
  token: string,
  data: WorkOrderTypeInput,
): Promise<{ type: WorkOrderTypeItem }> {
  return authRequest<{ type: WorkOrderTypeItem }>("/work-order-types", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateWorkOrderType(
  token: string,
  id: string,
  data: Partial<WorkOrderTypeInput>,
): Promise<{ type: WorkOrderTypeItem }> {
  return authRequest<{ type: WorkOrderTypeItem }>(`/work-order-types/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteWorkOrderType(
  token: string,
  id: string,
): Promise<{ type: WorkOrderTypeItem; message: string }> {
  return authRequest<{ type: WorkOrderTypeItem; message: string }>(
    `/work-order-types/${id}`,
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
  | "work_order_note"
  | "estimate_note"
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
  | "estimate"
  | "discount_code"
  | "mailbox_message"
  | "contact_form"
  | "task";

export type NotificationAction =
  | "created"
  | "updated"
  | "deleted"
  | "merged"
  | "renewed"
  | "assigned"
  | "mentioned";

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
  status: "sent" | "failed" | "skipped";
  emailId?: string;
  error?: string;
}

export interface EmailSendResponse {
  results: EmailSendResultItem[];
  summary: { total: number; sent: number; skipped?: number; failed: number };
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
    offerContractTemplateId?: string | null;
    invoiceId?: string;
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
    expectedAmountCents?: number;
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
    offerContractTemplateId?: string | null;
    offerContractOverrides?: {
      contactId: string;
      contractTemplateId: string | null;
    }[];
    /** Replaces the contact's email for a single-contact send. */
    toOverride?: string;
    invoiceId?: string;
  },
): Promise<EmailSendResponse> {
  return authRequest<EmailSendResponse>("/email-messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export type ScheduledEmailStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed";

export interface ScheduledEmailItem {
  _id: string;
  contactIds: string[];
  recipientCount: number;
  subject: string;
  fromName: string;
  replyTo: string | null;
  emailAccountRef: string | null;
  accountFriendlyName: string | null;
  emailsPerSecond: number;
  includePaymentLink: boolean;
  scheduledAt: string;
  status: ScheduledEmailStatus;
  summary: {
    total: number;
    sent: number;
    skipped: number;
    failed: number;
  } | null;
  errorMessage: string | null;
  cancelledAt: string | null;
  createdByUserRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function scheduleEmailMessages(
  token: string,
  data: {
    expectedAmountCents?: number;
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
    offerContractTemplateId?: string | null;
    offerContractOverrides?: {
      contactId: string;
      contractTemplateId: string | null;
    }[];
    scheduledAt: string;
    invoiceId?: string;
  },
): Promise<{ scheduled: ScheduledEmailItem }> {
  return authRequest<{ scheduled: ScheduledEmailItem }>(
    "/email-messages/schedule",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
}

export async function getScheduledEmails(
  token: string,
  options?: {
    status?: ScheduledEmailStatus | "all";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  scheduled: ScheduledEmailItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  return authRequest<{
    scheduled: ScheduledEmailItem[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/email-messages/scheduled${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function rescheduleEmailMessages(
  token: string,
  id: string,
  scheduledAt: string,
): Promise<{ scheduled: ScheduledEmailItem }> {
  return authRequest<{ scheduled: ScheduledEmailItem }>(
    `/email-messages/scheduled/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scheduledAt }),
    },
  );
}

export async function cancelScheduledEmail(
  token: string,
  id: string,
): Promise<{ scheduled: ScheduledEmailItem }> {
  return authRequest<{ scheduled: ScheduledEmailItem }>(
    `/email-messages/scheduled/${id}/cancel`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getSentEmails(
  token: string,
  options?: {
    customerId?: string;
    contactId?: string;
    emailAccountId?: string;
    status?: "sent" | "failed";
    from?: string;
    to?: string;
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
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
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

export type LegacyDumpKind = "customers" | "work_orders";

export type LegacyDumpTargetInfo = {
  available: boolean;
  label: string | null;
  reason?: string;
};

export type LegacyDumpCustomerRow = {
  sqlId: number;
  sqlName: string;
  phone: string;
  email: string;
};

export type LegacyDumpIdentityRow = LegacyDumpCustomerRow & {
  reason: "phone" | "email" | "address";
  mongoLegacyId: number;
  mongoName: string;
};

export type LegacyDumpCollisionRow = LegacyDumpCustomerRow & {
  occupiedBy: string;
  occupiedLegacyId: number;
  assignedId: number;
};

export type LegacyDumpMissingWoRow = {
  woId: number;
  customerId: number;
  customerName: string;
  date: string;
};

export type LegacyDumpOrphanWoRow = {
  woId: number;
  customerId: number;
};

export type LegacyDumpAuditReport = {
  customersPresent: number;
  customersIdentityLinked: LegacyDumpIdentityRow[];
  customersMissing: LegacyDumpCustomerRow[];
  customersCollisions: LegacyDumpCollisionRow[];
  wosPresent: number;
  wosFuzzy: number;
  wosMissing: LegacyDumpMissingWoRow[];
  wosOrphan: LegacyDumpOrphanWoRow[];
};

export type LegacyDumpImportSummary = {
  customersParsed: number;
  customersInserted: number;
  contactsCreated: number;
  customersSkippedLegacy: number;
  customersSkippedIdentity: number;
  customerCollisions: number;
  workOrdersParsed: number;
  workOrdersInserted: number;
  workOrdersSkippedLegacy: number;
  workOrdersSkippedFuzzy: number;
  workOrderOrphans: number;
  workOrdersLineItemsBackfilled?: number;
  workOrdersStatusUpdated?: number;
  workOrdersSkippedDuplicateLegacy?: number;
  workOrdersSkippedUserMismatch?: number;
  ascCustomers?: number;
  contractsCreated?: number;
  contractsUpdated?: number;
};

export type LegacyDumpTargetResult = {
  target: "production" | "development" | "custom";
  targetLabel: string;
  mode: "audit" | "import";
  customersParsed: number;
  workOrdersParsed: number;
  audit: LegacyDumpAuditReport;
  summary: LegacyDumpImportSummary;
};

export type LegacyDumpResponse = {
  files: Array<{ filename: string; kind: LegacyDumpKind }>;
  targets: {
    production: LegacyDumpTargetInfo;
    development: LegacyDumpTargetInfo;
  };
  production?: LegacyDumpTargetResult;
  development?: LegacyDumpTargetResult;
  errors?: {
    production?: string;
    development?: string;
  };
};

function appendLegacyDumpFiles(payload: FormData, files: File[]): void {
  for (const file of files) {
    payload.append("files", file);
  }
}

export async function getLegacyDumpTargets(
  token: string,
): Promise<{
  targets: LegacyDumpResponse["targets"];
}> {
  return authRequest(`/legacy-dumps/targets`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function auditLegacyDump(
  token: string,
  files: File[],
): Promise<LegacyDumpResponse> {
  const payload = new FormData();
  appendLegacyDumpFiles(payload, files);
  return authRequest<LegacyDumpResponse>("/legacy-dumps/audit", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  });
}

export async function executeLegacyDump(
  token: string,
  files: File[],
  options: {
    production: boolean;
    development: boolean;
    confirmProduction?: boolean;
  },
): Promise<LegacyDumpResponse> {
  const payload = new FormData();
  appendLegacyDumpFiles(payload, files);
  payload.append("production", options.production ? "true" : "false");
  payload.append("development", options.development ? "true" : "false");
  payload.append(
    "confirmProduction",
    options.confirmProduction ? "true" : "false",
  );
  return authRequest<LegacyDumpResponse>("/legacy-dumps/execute", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  });
}

export type LegacyDumpLogHandler = (
  message: string,
  level: string,
  ts: string,
) => void;

function dumpStreamOnEvent(
  onLog: LegacyDumpLogHandler | undefined,
): (event: string, data: unknown) => void {
  return (event, data) => {
    if (event !== "log" || !data || typeof data !== "object") return;
    const row = data as { message?: string; level?: string; ts?: string };
    if (typeof row.message === "string") {
      onLog?.(
        row.message,
        row.level ?? "info",
        row.ts ?? new Date().toISOString(),
      );
    }
  };
}

export async function streamLegacyDumpAudit(
  token: string,
  files: File[],
  onLog?: LegacyDumpLogHandler,
): Promise<LegacyDumpResponse> {
  const payload = new FormData();
  appendLegacyDumpFiles(payload, files);
  const result = await streamAuthRequest(
    "/legacy-dumps/audit",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
    },
    dumpStreamOnEvent(onLog),
  );
  if (!result) throw new ApiError("Audit finished without a result.", 500);
  return result as LegacyDumpResponse;
}

export async function streamLegacyDumpExecute(
  token: string,
  files: File[],
  options: {
    production: boolean;
    development: boolean;
    confirmProduction?: boolean;
  },
  onLog?: LegacyDumpLogHandler,
): Promise<LegacyDumpResponse> {
  const payload = new FormData();
  appendLegacyDumpFiles(payload, files);
  payload.append("production", options.production ? "true" : "false");
  payload.append("development", options.development ? "true" : "false");
  payload.append(
    "confirmProduction",
    options.confirmProduction ? "true" : "false",
  );
  const result = await streamAuthRequest(
    "/legacy-dumps/execute",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
    },
    dumpStreamOnEvent(onLog),
  );
  if (!result) throw new ApiError("Import finished without a result.", 500);
  return result as LegacyDumpResponse;
}

export async function streamLegacyDumpCommand(
  token: string,
  command: string,
  files: File[],
  onLog?: LegacyDumpLogHandler,
): Promise<unknown> {
  const payload = new FormData();
  payload.append("command", command);
  appendLegacyDumpFiles(payload, files);
  return streamAuthRequest(
    "/legacy-dumps/command",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
    },
    dumpStreamOnEvent(onLog),
  );
}

export type DatabaseInspectTarget = "production" | "development" | "mysql";

export type DatabaseInspectKind = "mongo" | "mysql";

export type DatabaseOverview = {
  id: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  label: string | null;
  status: "connected" | "disconnected" | "unavailable";
  reason?: string;
  collectionCount?: number;
};

export type DatabaseCollectionInfo = {
  name: string;
  count: number;
};

export type DatabaseCollectionsResult = {
  target: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  label: string;
  collections: DatabaseCollectionInfo[];
};

export type DatabaseDocumentsPage = {
  target: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  name: string;
  documents: Record<string, unknown>[];
  total: number;
  limit: number;
  skip: number;
};

export type DatabaseDocumentResult = {
  target: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  name: string;
  document: Record<string, unknown>;
};

export async function getDatabaseOverviews(
  token: string,
): Promise<{ databases: DatabaseOverview[] }> {
  return authRequest("/databases", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getDatabaseCollections(
  token: string,
  target: DatabaseInspectTarget,
): Promise<DatabaseCollectionsResult> {
  return authRequest(`/databases/${target}/collections`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getDatabaseDocuments(
  token: string,
  target: DatabaseInspectTarget,
  name: string,
  options: { limit?: number; skip?: number; id?: string } = {},
): Promise<DatabaseDocumentsPage> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.skip != null) params.set("skip", String(options.skip));
  if (options.id) params.set("id", options.id);
  const qs = params.toString();
  return authRequest(
    `/databases/${target}/collections/${encodeURIComponent(name)}/documents${
      qs ? `?${qs}` : ""
    }`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export type InboxChannel = "sms" | "mms" | "voice" | "email";
export type InboxHandleKind = "phone" | "email";

export interface InboxConversationItem {
  id: string;
  customerId: string | null;
  displayName: string;
  handle: string;
  handleKind: InboxHandleKind;
  phone: string;
  email: string;
  lastMessageAt: string | null;
  lastPreview: string;
  lastChannel: InboxChannel | null;
  lastDirection: "inbound" | "outbound" | null;
  unreadCount: number;
  status: "open" | "closed";
  readAt: string | null;
  readByName: string | null;
  pinned: boolean;
  blocked: boolean;
  openTaskCount: number;
  ourNumber: string;
  emailAccountId: string | null;
}

export interface InboxTimelineMessage {
  id: string;
  channel: InboxChannel;
  direction: "inbound" | "outbound";
  at: string;
  body: string;
  html: string;
  subject: string;
  status: string;
  from: string;
  to: string;
  senderName: string;
  mediaUrls: string[];
  attachments: {
    filename: string;
    size: number;
    contentType: string;
    partId: string;
  }[];
  durationSeconds: number | null;
  transcript: string;
  transcriptStatus?: "none" | "pending" | "completed" | "failed";
  callSummary?: string;
  suggestedTask?: { title: string; description: string; dueInDays: number | null } | null;
  transcriptRating?: { stars: number; comment: string } | null;
  followUpTask?: { id: string; title: string } | null;
  taskPromptDismissed?: boolean;
  emailAccountId: string | null;
  imapUid: number | null;
}

export interface InboxContext {
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
  } | null;
  contacts: {
    id: string;
    name: string;
    phone: string;
    email: string;
    label: string;
    isPrimary: boolean;
  }[];
  workOrders: {
    id: string;
    number: string;
    summary: string;
    scheduledStart: string | null;
    total: number;
  }[];
  invoices: {
    id: string;
    number: string;
    amountCents: number;
    status: string;
    dueDate: string | null;
  }[];
  notes: {
    id: string;
    content: string;
    authorName: string;
    createdAt: string;
  }[];
  conversationId?: string;
}

export interface InboxChannels {
  twilioAccounts: {
    id: string;
    friendlyName: string;
    browserCalling: boolean;
    numbers: { phoneNumber: string; label: string; voice: boolean }[];
  }[];
  emailAccounts: {
    id: string;
    friendlyName: string;
    fromEmail: string;
    fromName: string;
  }[];
}

export interface InboxTemplate {
  id: string;
  name: string;
  type: "sms" | "email";
  subject: string;
  body: string;
}

function inboxQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function getInboxConversations(
  token: string,
  options: {
    status?: "open" | "closed" | "all";
    filter?: "" | "unread" | "unresponded";
    channel?: "" | "text" | "email" | "voice" | "sms" | "mms";
    q?: string;
    cursor?: string;
    blocked?: boolean;
  } = {},
): Promise<{
  conversations: InboxConversationItem[];
  pinned?: InboxConversationItem[];
  nextCursor: string | null;
}> {
  return authRequest(
    `/inboxes/conversations${inboxQuery({
      status: options.status,
      filter: options.filter,
      channel: options.channel,
      q: options.q,
      cursor: options.cursor,
      blocked: options.blocked ? "1" : undefined,
    })}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function getInboxTimeline(
  token: string,
  id: string,
  before?: string,
  limit?: number,
): Promise<{
  conversation: InboxConversationItem | null;
  messages: InboxTimelineMessage[];
  hasMore: boolean;
  nextBefore: string | null;
}> {
  return authRequest(
    `/inboxes/conversations/${id}/timeline${inboxQuery({
      before,
      limit: limit ? String(limit) : undefined,
    })}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function markInboxConversationRead(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function markInboxConversationUnread(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/unread`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function pinInboxConversation(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/pin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function unpinInboxConversation(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/unpin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function blockInboxConversation(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/block`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function unblockInboxConversation(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/unblock`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteInboxConversation(
  token: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return authRequest(`/inboxes/conversations/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function closeInboxConversation(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function reopenInboxConversation(
  token: string,
  id: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/reopen`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface InboxScheduledMessage {
  id: string;
  body: string;
  mediaUrls: string[];
  scheduledAt: string;
  status: string;
}

export interface InboxMediaUpload {
  url: string;
  mimeType: string;
  size: number;
  name: string;
}

export async function uploadInboxMedia(
  token: string,
  file: File,
): Promise<InboxMediaUpload> {
  const payload = new FormData();
  payload.append("file", file);
  return authRequest<InboxMediaUpload>("/inboxes/media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  });
}

export async function sendInboxSms(
  token: string,
  id: string,
  data: {
    body?: string;
    mediaUrls?: string[];
    templateId?: string;
    contactId?: string;
    toNumber?: string;
    fromNumber?: string;
    twilioAccountId?: string;
  },
): Promise<{ summary?: { sent: number; failed: number }; errorMessage?: string | null }> {
  return authRequest(`/inboxes/conversations/${id}/sms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function scheduleInboxSms(
  token: string,
  id: string,
  data: {
    body?: string;
    mediaUrls?: string[];
    templateId?: string;
    contactId?: string;
    toNumber?: string;
    fromNumber?: string;
    twilioAccountId?: string;
    scheduledAt: string;
  },
): Promise<{ scheduled: InboxScheduledMessage }> {
  return authRequest(`/inboxes/conversations/${id}/sms/schedule`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function listInboxScheduled(
  token: string,
  id: string,
): Promise<{ scheduled: InboxScheduledMessage[] }> {
  return authRequest(`/inboxes/conversations/${id}/scheduled`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function cancelInboxScheduled(
  token: string,
  scheduledId: string,
): Promise<{ scheduled: InboxScheduledMessage }> {
  return authRequest(`/inboxes/scheduled/${scheduledId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function sendInboxEmail(
  token: string,
  id: string,
  data: {
    body?: string;
    html?: string;
    subject?: string;
    emailAccountId?: string;
    contactId?: string;
    to?: string | string[];
    cc?: string[];
    bcc?: string[];
    templateId?: string;
    useBrandTemplate?: boolean;
    includeQuoted?: boolean;
  },
): Promise<{ sent: boolean }> {
  return authRequest(`/inboxes/conversations/${id}/email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function callInboxConversation(
  token: string,
  id: string,
  data: { contactId?: string; fromNumber?: string; twilioAccountId?: string } = {},
): Promise<{ sent: boolean }> {
  return authRequest(`/inboxes/conversations/${id}/call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function linkInboxCustomer(
  token: string,
  id: string,
  customerId: string,
): Promise<{ conversation: InboxConversationItem }> {
  return authRequest(`/inboxes/conversations/${id}/link-customer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerId }),
  });
}

export async function getInboxContext(
  token: string,
  id: string,
): Promise<InboxContext> {
  return authRequest(`/inboxes/conversations/${id}/context`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function addInboxNote(
  token: string,
  id: string,
  content: string,
): Promise<{ note: InboxContext["notes"][number] }> {
  return authRequest(`/inboxes/conversations/${id}/context`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
}

export async function searchInboxCustomers(
  token: string,
  q: string,
): Promise<{
  customers: { id: string; name: string; phone: string; email: string }[];
}> {
  return authRequest(`/inboxes/customers${inboxQuery({ q })}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getInboxChannels(token: string): Promise<InboxChannels> {
  return authRequest("/inboxes/channels", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: "open" | "done";
  dueAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  assigneeName: string;
  createdByName: string;
  customerId: string | null;
  customerName: string;
  conversationId: string | null;
  conversationName: string;
  source: "inbox" | "manual";
  onSchedule: boolean;
  scheduledTechnicianId: string | null;
  scheduledTechnicianName: string;
  scheduledStart: string | null;
  scheduledMinutes: number;
}

export interface TaskAssignee {
  id: string;
  name: string;
}

export async function getTasks(
  token: string,
  options: {
    assignee?: "me" | "all" | string;
    status?: "" | "open" | "done";
    due?: "" | "overdue" | "today" | "upcoming";
    customerId?: string;
    conversationId?: string;
  } = {},
): Promise<{ tasks: TaskItem[] }> {
  return authRequest(
    `/tasks${inboxQuery({
      assignee: options.assignee,
      status: options.status,
      due: options.due,
      customerId: options.customerId,
      conversationId: options.conversationId,
    })}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function getTaskAssignees(
  token: string,
): Promise<{ assignees: TaskAssignee[] }> {
  return authRequest("/tasks/assignees", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createTask(
  token: string,
  data: {
    title: string;
    description?: string;
    dueAt?: string | null;
    assigneeId?: string | null;
    conversationId?: string;
    customerId?: string;
    communicationId?: string;
    source?: "inbox" | "manual";
    onSchedule?: boolean;
    scheduledTechnicianId?: string | null;
    scheduledStart?: string | null;
    scheduledMinutes?: number;
  },
): Promise<{ task: TaskItem }> {
  return authRequest("/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateTask(
  token: string,
  id: string,
  data: {
    title?: string;
    description?: string;
    dueAt?: string | null;
    assigneeId?: string | null;
    status?: "open" | "done";
    onSchedule?: boolean;
    scheduledTechnicianId?: string | null;
    scheduledStart?: string | null;
    scheduledMinutes?: number;
  },
): Promise<{ task: TaskItem }> {
  return authRequest(`/tasks/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function completeTask(
  token: string,
  id: string,
): Promise<{ task: TaskItem }> {
  return authRequest(`/tasks/${id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function reopenTask(
  token: string,
  id: string,
): Promise<{ task: TaskItem }> {
  return authRequest(`/tasks/${id}/reopen`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteTask(
  token: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return authRequest(`/tasks/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getInboxTemplates(
  token: string,
  type?: "sms" | "email",
): Promise<{ templates: InboxTemplate[] }> {
  return authRequest(`/inboxes/templates${inboxQuery({ type })}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}
