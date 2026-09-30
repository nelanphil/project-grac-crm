import { Types } from "mongoose";
import {
  IJobRoleField,
  JobRole,
  JobRoleFieldType,
} from "../models/mongo/JobRole";

export type JobRoleCapability = "schedulable" | "territoryOwner";

export class JobRoleDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobRoleDataError";
  }
}

type CapabilityCache = Record<JobRoleCapability, string[]>;

let capabilityCache: CapabilityCache | null = null;

export function clearJobRoleCapabilityCache(): void {
  capabilityCache = null;
}

async function loadCapabilityCache(): Promise<CapabilityCache> {
  if (capabilityCache) return capabilityCache;
  const roles = await JobRole.find({ deletedAt: null })
    .select("capabilities")
    .lean();
  const schedulable: string[] = [];
  const territoryOwner: string[] = [];
  for (const role of roles) {
    const id = String(role._id);
    if (role.capabilities?.schedulable) schedulable.push(id);
    if (role.capabilities?.territoryOwner) territoryOwner.push(id);
  }
  capabilityCache = { schedulable, territoryOwner };
  return capabilityCache;
}

export async function getJobRoleIdsWithCapability(
  capability: JobRoleCapability,
): Promise<string[]> {
  const cache = await loadCapabilityCache();
  return cache[capability];
}

export async function getCapabilitySets(): Promise<{
  schedulable: Set<string>;
  territoryOwner: Set<string>;
}> {
  const [schedulable, territoryOwner] = await Promise.all([
    getJobRoleIdsWithCapability("schedulable"),
    getJobRoleIdsWithCapability("territoryOwner"),
  ]);
  return {
    schedulable: new Set(schedulable),
    territoryOwner: new Set(territoryOwner),
  };
}

export function capabilitiesFromIds(
  ids: unknown[] | null | undefined,
  sets: { schedulable: Set<string>; territoryOwner: Set<string> },
): { schedulable: boolean; territoryOwner: boolean } {
  const list = (ids ?? []).map((id) => String(id));
  return {
    schedulable: list.some((id) => sets.schedulable.has(id)),
    territoryOwner: list.some((id) => sets.territoryOwner.has(id)),
  };
}

export async function capabilitiesForJobRoleIds(
  ids: unknown[] | null | undefined,
): Promise<{ schedulable: boolean; territoryOwner: boolean }> {
  return capabilitiesFromIds(ids, await getCapabilitySets());
}

/** Slugs for the given job-role ids, in the same order, skipping missing roles. */
export async function slugsForJobRoleIds(
  ids: unknown[] | null | undefined,
): Promise<string[]> {
  const list = (ids ?? [])
    .map((id) => String(id))
    .filter((id) => Types.ObjectId.isValid(id));
  if (list.length === 0) return [];
  const roles = await JobRole.find({
    _id: { $in: list },
    deletedAt: null,
  })
    .select("slug")
    .lean();
  const byId = new Map(roles.map((role) => [String(role._id), role.slug]));
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const id of list) {
    const slug = byId.get(id);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

export async function userHasCapability(
  user: { jobRoles?: unknown[] | null },
  capability: JobRoleCapability,
): Promise<boolean> {
  const ids = (user.jobRoles ?? []).map((id) => String(id));
  if (ids.length === 0) return false;
  const capable = await getJobRoleIdsWithCapability(capability);
  return ids.some((id) => capable.includes(id));
}

export async function rolesAreSchedulable(ids: unknown[]): Promise<boolean> {
  return userHasCapability({ jobRoles: ids }, "schedulable");
}

/** Mongo filter matching active users who hold a territory-owner job role. */
export async function territoryOwnerUserFilter(): Promise<
  Record<string, unknown>
> {
  const ids = await getJobRoleIdsWithCapability("territoryOwner");
  if (ids.length === 0) return { _id: { $exists: false } };
  return {
    jobRoles: { $in: ids.map((id) => new Types.ObjectId(id)) },
  };
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function fail(roleLabel: string, fieldLabel: string, message: string): never {
  throw new JobRoleDataError(`${roleLabel}: ${fieldLabel} ${message}`);
}

function coerceField(
  field: IJobRoleField,
  raw: unknown,
  roleLabel: string,
): unknown {
  switch (field.type as JobRoleFieldType) {
    case "checkbox":
      return raw === true || raw === "true" || raw === "on" || raw === 1;
    case "number": {
      const num = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(num)) fail(roleLabel, field.label, "must be a number");
      return num;
    }
    case "date": {
      const value = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail(roleLabel, field.label, "must be a date (YYYY-MM-DD)");
      }
      return value;
    }
    case "email": {
      const value = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        fail(roleLabel, field.label, "must be an email address");
      }
      return value;
    }
    case "phone": {
      const value = String(raw).trim();
      const digits = value.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) {
        fail(roleLabel, field.label, "must be a phone number");
      }
      return value;
    }
    case "select": {
      const value = String(raw).trim();
      if (!field.options.includes(value)) {
        fail(roleLabel, field.label, "is not a valid option");
      }
      return value;
    }
    case "multiselect": {
      const list = Array.isArray(raw) ? raw : [raw];
      const values = list.map((item) => String(item).trim()).filter(Boolean);
      if (values.some((value) => !field.options.includes(value))) {
        fail(roleLabel, field.label, "includes an invalid option");
      }
      return values;
    }
    case "textarea":
    case "text":
    default:
      return String(raw).trim();
  }
}

/**
 * Keep only values for fields defined on the assigned job roles.
 * Throws JobRoleDataError when a required field is missing or a value is the wrong type.
 */
export function validateJobRoleData(
  jobRoles: Array<{ _id: unknown; label: string; fields?: IJobRoleField[] | null }>,
  data: Record<string, Record<string, unknown>> | null | undefined,
): Record<string, Record<string, unknown>> {
  const input = data ?? {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const role of jobRoles) {
    const id = String(role._id);
    const values =
      input[id] && typeof input[id] === "object" ? input[id] : {};
    const cleaned: Record<string, unknown> = {};
    for (const field of role.fields ?? []) {
      const raw = values[field.key];
      if (field.type === "checkbox") {
        const checked = coerceField(field, raw, role.label) === true;
        if (field.required && !checked) {
          fail(role.label, field.label, "must be checked");
        }
        cleaned[field.key] = checked;
        continue;
      }
      if (isEmptyValue(raw)) {
        if (field.required) fail(role.label, field.label, "is required");
        continue;
      }
      cleaned[field.key] = coerceField(field, raw, role.label);
    }
    out[id] = cleaned;
  }
  return out;
}
