import { Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  User,
  activeUserFilter,
  IUserTerritories,
  IUserHomeLocation,
  IWeeklyHours,
  IScheduleException,
} from "../models/mongo/User";
import { Role } from "../models/mongo/Role";
import { JobRole } from "../models/mongo/JobRole";
import { createUserSchema, updateUserSchema } from "../schemas/user.schema";
import { resolveGeocodedAddress } from "../utils/resolveGeocodedAddress";
import { updateRoleSchema } from "../schemas/auth.schema";
import {
  applyUsername,
  rebalanceUsernameGroup,
  usernameNumberFromKey,
} from "../utils/username";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  emptyTerritories,
  findTerritoryConflicts,
  normalizeTerritoriesInput,
  scheduleOwnerReassignment,
} from "../utils/ownerTerritory";
import {
  EMAIL_CONFLICT_ADMIN,
  findEmailConflict,
  provisionCrmCustomerForUser,
} from "../utils/provisionCustomerAccount";
import { syncCustomersToUserEmail } from "../utils/ensureCustomerLogin";
import { renameEmailPreferences } from "../utils/emailPreferences";
import {
  capabilitiesFromIds,
  getCapabilitySets,
  JobRoleDataError,
  userHasCapability,
  validateJobRoleData,
} from "../utils/jobRoles";
import {
  isCustomerRole,
  isSuperAdminRole,
  RoleAssignmentError,
  rolesFromPayload,
  syncRoleFields,
} from "../utils/roles";
import {
  defaultWeeklyHours,
  emptyHomeLocation,
  weeklyHoursNeverEnabled,
} from "../utils/scheduleTime";

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function formatTerritories(
  territories?: IUserTerritories | null,
): { counties: string[]; zips: string[] } {
  return {
    counties: territories?.counties ?? [],
    zips: territories?.zips ?? [],
  };
}

function formatHomeLocation(
  loc?: IUserHomeLocation | null,
): IUserHomeLocation {
  return {
    address: loc?.address ?? "",
    city: loc?.city ?? "",
    state: loc?.state ?? "",
    zip: loc?.zip ?? "",
    lat: typeof loc?.lat === "number" ? loc.lat : null,
    lng: typeof loc?.lng === "number" ? loc.lng : null,
  };
}

function formatWeeklyHours(hours?: IWeeklyHours | null): IWeeklyHours {
  const fallback = defaultWeeklyHours(false);
  if (!hours) return fallback;
  return {
    sun: hours.sun ?? fallback.sun,
    mon: hours.mon ?? fallback.mon,
    tue: hours.tue ?? fallback.tue,
    wed: hours.wed ?? fallback.wed,
    thu: hours.thu ?? fallback.thu,
    fri: hours.fri ?? fallback.fri,
    sat: hours.sat ?? fallback.sat,
  };
}

async function geocodeHomeLocation(input: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ location: IUserHomeLocation; error?: string }> {
  const address = (input.address ?? "").trim();
  const city = (input.city ?? "").trim();
  const state = (input.state ?? "").trim();
  const zip = (input.zip ?? "").trim();
  if (!address) {
    return { location: emptyHomeLocation() };
  }

  if (
    typeof input.lat === "number" &&
    typeof input.lng === "number" &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    return {
      location: { address, city, state, zip, lat: input.lat, lng: input.lng },
    };
  }

  const geocode = await resolveGeocodedAddress({ street: address, city, state, zip });
  if (!geocode.ok) {
    return {
      location: emptyHomeLocation(),
      error: geocode.message || "Home address could not be validated",
    };
  }
  const coords = geocode.match.coordinates;
  const normalized = geocode.match.normalized;
  return {
    location: {
      address: normalized.address || address,
      city: normalized.city || city,
      state: normalized.state || state,
      zip: normalized.zip || zip,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    },
  };
}

function formatUser(
  user: {
    _id: unknown;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    roles?: string[];
    userType?: string | null;
    jobRoles?: unknown[] | null;
    jobRoleData?: Record<string, Record<string, unknown>> | null;
    username?: string | null;
    usernameKey?: string | null;
    territories?: IUserTerritories | null;
    schedulable?: boolean;
    homeLocation?: IUserHomeLocation | null;
    weeklyHours?: IWeeklyHours | null;
    scheduleExceptions?: IScheduleException[] | null;
    createdAt: Date;
    updatedAt?: Date;
  },
  sets: { schedulable: Set<string>; territoryOwner: Set<string> },
) {
  const synced = syncRoleFields(user);
  const jobRoles = (user.jobRoles ?? []).map((id) => String(id));
  const capabilities = capabilitiesFromIds(jobRoles, sets);
  const userType = user.userType === "customer" ? "customer" : "staff";
  return {
    _id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: userType === "customer" ? "customer" : synced.role,
    roles: userType === "customer" ? ["customer"] : synced.roles,
    userType,
    jobRoles: userType === "customer" ? [] : jobRoles,
    jobRoleData: userType === "customer" ? {} : (user.jobRoleData ?? {}),
    capabilities,
    schedulable: capabilities.schedulable,
    username: user.username ?? null,
    usernameNumber: usernameNumberFromKey(user.username, user.usernameKey),
    territories: formatTerritories(user.territories),
    homeLocation: formatHomeLocation(user.homeLocation),
    weeklyHours: formatWeeklyHours(user.weeklyHours),
    scheduleExceptions: user.scheduleExceptions ?? [],
    createdAt: user.createdAt,
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
  };
}

async function presentUsers<T extends Parameters<typeof formatUser>[0]>(
  users: T[],
) {
  const sets = await getCapabilitySets();
  return users.map((user) => formatUser(user, sets));
}

async function assertRolesExist(slugs: string[]): Promise<boolean> {
  const roles = await Role.find({
    slug: { $in: slugs },
    deletedAt: null,
  })
    .select("slug")
    .lean();
  return roles.length === slugs.length;
}

async function resolveAssignedRoles(input: {
  role?: string;
  roles?: string[];
}): Promise<{ ok: true; roles: string[]; role: string } | { ok: false; message: string }> {
  try {
    const assigned = rolesFromPayload(input);
    if (!(await assertRolesExist(assigned))) {
      return { ok: false, message: "Invalid or deleted role" };
    }
    const synced = syncRoleFields({ roles: assigned });
    return { ok: true, roles: synced.roles, role: synced.role };
  } catch (err) {
    const message =
      err instanceof RoleAssignmentError ? err.message : "Invalid role";
    return { ok: false, message };
  }
}

async function resolveJobRoles(
  ids: string[] | undefined,
  userType: "staff" | "customer",
): Promise<
  | {
      ok: true;
      ids: Types.ObjectId[];
      docs: Array<{
        _id: Types.ObjectId;
        label: string;
        fields?: Parameters<typeof validateJobRoleData>[0][number]["fields"];
      }>;
    }
  | { ok: false; message: string }
> {
  if (userType === "customer" || !ids || ids.length === 0) {
    return { ok: true, ids: [], docs: [] };
  }
  const unique = [...new Set(ids)];
  if (unique.some((id) => !Types.ObjectId.isValid(id))) {
    return { ok: false, message: "Invalid job role" };
  }
  const docs = await JobRole.find({
    _id: { $in: unique },
    deletedAt: null,
  }).lean();
  if (docs.length !== unique.length) {
    return { ok: false, message: "Invalid or deleted job role" };
  }
  return {
    ok: true,
    ids: docs.map((doc) => doc._id as Types.ObjectId),
    docs: docs.map((doc) => ({
      _id: doc._id as Types.ObjectId,
      label: doc.label,
      fields: doc.fields,
    })),
  };
}

function formatConflictMessage(
  conflicts: Awaited<ReturnType<typeof findTerritoryConflicts>>,
): string {
  const parts = conflicts.map((c) => {
    const label = c.type === "county" ? `county ${c.value}` : `ZIP ${c.value}`;
    return `${label} (held by ${c.ownerName || c.ownerId})`;
  });
  return `Territory conflict: ${parts.join("; ")}`;
}

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Include usernameKey server-side only to derive usernameNumber; strip via formatUser
    const users = await User.find(activeUserFilter, "-password_hash")
      .lean()
      .sort({ createdAt: -1 });
    res.status(200).json({
      users: await presentUsers(users),
    });
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createUser(req: AuthRequest, res: Response): Promise<void> {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, first_name, last_name, username } = parsed.data;
  const plainPassword = parsed.data.password ?? generateTempPassword();
  const passwordWasGenerated = !parsed.data.password;

  try {
    const assigned = await resolveAssignedRoles(parsed.data);
    if (!assigned.ok) {
      res.status(400).json({ message: assigned.message });
      return;
    }
    const userType =
      parsed.data.userType ??
      (isCustomerRole(assigned.roles) ? "customer" : "staff");
    const roles =
      userType === "customer" ? ["customer"] : assigned.roles;
    const role = userType === "customer" ? "customer" : assigned.role;
    if (userType === "staff" && isCustomerRole(roles)) {
      res.status(400).json({ message: "Staff users cannot have the customer role" });
      return;
    }
    const isCustomer = userType === "customer";

    const jobs = await resolveJobRoles(parsed.data.jobRoles, userType);
    if (!jobs.ok) {
      res.status(400).json({ message: jobs.message });
      return;
    }
    let jobRoleData: Record<string, Record<string, unknown>> = {};
    if (!isCustomer) {
      try {
        jobRoleData = validateJobRoleData(jobs.docs, parsed.data.jobRoleData);
      } catch (err) {
        if (err instanceof JobRoleDataError) {
          res.status(400).json({ message: err.message });
          return;
        }
        throw err;
      }
    }
    const caps = capabilitiesFromIds(jobs.ids, await getCapabilitySets());
    const isOwner = caps.territoryOwner;
    const isTech = caps.schedulable;

    const territories =
      isOwner && parsed.data.territories
        ? normalizeTerritoriesInput(parsed.data.territories)
        : emptyTerritories();

    if (isOwner && (territories.counties.length || territories.zips.length)) {
      const conflicts = await findTerritoryConflicts(territories);
      if (conflicts.length > 0) {
        res.status(409).json({
          message: formatConflictMessage(conflicts),
          conflicts,
        });
        return;
      }
    }

    const normalizedEmail = email.toLowerCase();
    const activeWithEmail = await User.findOne({
      email: normalizedEmail,
      ...activeUserFilter,
    });
    const softDeleted = activeWithEmail
      ? null
      : await User.findOne({
          email: normalizedEmail,
          deletedAt: { $ne: null },
        });
    const promoteCustomerLogin =
      !isCustomer && activeWithEmail && isCustomerRole(activeWithEmail)
        ? activeWithEmail
        : null;
    const emailConflict = await findEmailConflict(normalizedEmail, {
      excludeUserId: promoteCustomerLogin?._id ?? softDeleted?._id ?? null,
      forStaffAccount: !isCustomer,
    });
    if (emailConflict) {
      const message =
        isCustomer || emailConflict.type === "customer"
          ? EMAIL_CONFLICT_ADMIN
          : "Email already in use";
      res.status(409).json({ message });
      return;
    }

    const password_hash = await bcrypt.hash(plainPassword, 10);
    const weeklyHours =
      parsed.data.weeklyHours ?? defaultWeeklyHours(isTech);

    let homeLocation = emptyHomeLocation();
    if (parsed.data.homeLocation) {
      const geo = await geocodeHomeLocation(parsed.data.homeLocation);
      if (geo.error) {
        res.status(422).json({ message: geo.error });
        return;
      }
      homeLocation = geo.location;
    }

    const scheduleExceptions = parsed.data.scheduleExceptions ?? [];

    let user;
    let restored = false;
    const reuse = promoteCustomerLogin ?? softDeleted;
    if (reuse) {
      reuse.password_hash = password_hash;
      reuse.first_name = first_name;
      reuse.last_name = last_name;
      reuse.roles = roles;
      reuse.role = role;
      reuse.userType = userType;
      reuse.jobRoles = jobs.ids;
      reuse.jobRoleData = jobRoleData;
      reuse.markModified("jobRoleData");
      reuse.territories = territories;
      reuse.weeklyHours = weeklyHours;
      reuse.homeLocation = homeLocation;
      reuse.scheduleExceptions = scheduleExceptions;
      reuse.deletedAt = null;
      if (username !== undefined) {
        try {
          await applyUsername(reuse, username === "" ? null : username);
        } catch (err) {
          res.status(400).json({
            message: err instanceof Error ? err.message : "Invalid username",
          });
          return;
        }
      }
      await reuse.save();
      user = reuse;
      restored = true;
    } else {
      user = await User.create({
        email,
        password_hash,
        first_name,
        last_name,
        role,
        roles,
        userType,
        jobRoles: jobs.ids,
        jobRoleData,
        territories,
        weeklyHours,
        homeLocation,
        scheduleExceptions,
      });
      if (username !== undefined && username !== "" && username !== null) {
        try {
          await applyUsername(user, username);
          await user.save();
        } catch (err) {
          await User.deleteOne({ _id: user._id });
          res.status(400).json({
            message: err instanceof Error ? err.message : "Invalid username",
          });
          return;
        }
      }
    }

    if (isCustomer) {
      try {
        await provisionCrmCustomerForUser(user);
      } catch (err) {
        if (!restored) {
          await User.deleteOne({ _id: user._id });
        }
        throw err;
      }
    }

    if (isOwner) {
      scheduleOwnerReassignment(`user-create=${String(user._id)}`);
    }

    res.status(201).json({
      user: (await presentUsers([user]))[0],
      ...(passwordWasGenerated ? { temporaryPassword: plainPassword } : {}),
    });

    logNotificationAsync({
      entityType: "user",
      action: "created",
      entityId: String(user._id),
      summary: `User ${user.email} created`,
      metadata: { email: user.email, role: user.role },
      ...actorFromRequest(req.user),
    });
  } catch (err) {
    console.error("POST /users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, first_name, last_name, username, password } = parsed.data;

  try {
    if (password !== undefined && !isSuperAdminRole(req.user)) {
      res.status(403).json({ message: "Only super-admins can set user passwords" });
      return;
    }

    const wantsRoleChange =
      parsed.data.roles !== undefined || parsed.data.role !== undefined;
    let assigned: { roles: string[]; role: string } | null = null;
    if (wantsRoleChange) {
      const resolved = await resolveAssignedRoles(parsed.data);
      if (!resolved.ok) {
        res.status(400).json({ message: resolved.message });
        return;
      }
      assigned = { roles: resolved.roles, role: resolved.role };
    }

    const user = await User.findOne({ _id: req.params.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const wasOwner = await userHasCapability(user, "territoryOwner");
    const wasCustomer = user.userType === "customer" || isCustomerRole(user);
    const wasTech = Boolean(user.schedulable);
    const previousTerritories = formatTerritories(user.territories);
    const previousEmail = user.email;
    const nextUserType =
      parsed.data.userType ??
      (assigned
        ? isCustomerRole(assigned.roles)
          ? "customer"
          : "staff"
        : user.userType === "customer"
          ? "customer"
          : "staff");

    if (nextUserType === "staff" && assigned && isCustomerRole(assigned.roles)) {
      res.status(400).json({ message: "Staff users cannot have the customer role" });
      return;
    }

    if (email !== undefined) {
      const normalized = email.toLowerCase();
      const emailConflict = await findEmailConflict(normalized, {
        excludeUserId: user._id,
        forStaffAccount: nextUserType === "staff",
      });
      if (emailConflict) {
        const message =
          nextUserType === "customer" || emailConflict.type === "customer"
            ? EMAIL_CONFLICT_ADMIN
            : "Email already in use";
        res.status(409).json({ message });
        return;
      }
      if (nextUserType === "staff") {
        const otherUser = await User.findOne({
          email: normalized,
          _id: { $ne: user._id },
          ...activeUserFilter,
        })
          .select("_id")
          .lean();
        if (otherUser) {
          res.status(409).json({ message: "Email already in use" });
          return;
        }
      }
      user.email = normalized;
    }
    if (first_name !== undefined) user.first_name = first_name;
    if (last_name !== undefined) user.last_name = last_name;

    if (assigned && nextUserType === "staff") {
      user.roles = assigned.roles;
      user.role = assigned.role;
    }
    user.userType = nextUserType;

    const jobs =
      parsed.data.jobRoles !== undefined
        ? await resolveJobRoles(parsed.data.jobRoles, nextUserType)
        : null;
    if (jobs && !jobs.ok) {
      res.status(400).json({ message: jobs.message });
      return;
    }
    if (nextUserType === "customer") {
      user.jobRoles = [];
      user.jobRoleData = {};
      user.markModified("jobRoleData");
    } else if (jobs) {
      user.jobRoles = jobs.ids;
    }

    if (nextUserType === "staff" && (jobs || parsed.data.jobRoleData !== undefined)) {
      const docs = jobs
        ? jobs.docs
        : (
            await JobRole.find({
              _id: { $in: user.jobRoles },
              deletedAt: null,
            }).lean()
          ).map((doc) => ({
            _id: doc._id,
            label: doc.label,
            fields: doc.fields,
          }));
      try {
        user.jobRoleData = validateJobRoleData(
          docs,
          parsed.data.jobRoleData !== undefined
            ? parsed.data.jobRoleData
            : user.jobRoleData,
        );
        user.markModified("jobRoleData");
      } catch (err) {
        if (err instanceof JobRoleDataError) {
          res.status(400).json({ message: err.message });
          return;
        }
        throw err;
      }
    }

    const nextCaps = capabilitiesFromIds(user.jobRoles, await getCapabilitySets());
    const nextIsOwner = nextUserType === "staff" && nextCaps.territoryOwner;
    const nextIsCustomer = nextUserType === "customer";
    const nextIsTech = nextUserType === "staff" && nextCaps.schedulable;
    if (!nextIsOwner) {
      user.territories = emptyTerritories();
    } else if (parsed.data.territories !== undefined) {
      const territories = normalizeTerritoriesInput(parsed.data.territories);
      const conflicts = await findTerritoryConflicts(territories, user._id);
      if (conflicts.length > 0) {
        res.status(409).json({
          message: formatConflictMessage(conflicts),
          conflicts,
        });
        return;
      }
      user.territories = territories;
    }

    if (username !== undefined) {
      try {
        await applyUsername(user, username === "" ? null : username);
      } catch (err) {
        res.status(400).json({
          message: err instanceof Error ? err.message : "Invalid username",
        });
        return;
      }
    }

    if (password !== undefined) {
      user.password_hash = await bcrypt.hash(password, 10);
    }

    if (parsed.data.weeklyHours !== undefined) {
      user.weeklyHours = parsed.data.weeklyHours;
    } else if (!wasTech && nextIsTech && weeklyHoursNeverEnabled(user.weeklyHours)) {
      user.weeklyHours = defaultWeeklyHours(true);
    }

    if (parsed.data.homeLocation !== undefined) {
      const geo = await geocodeHomeLocation(parsed.data.homeLocation);
      if (geo.error) {
        res.status(422).json({ message: geo.error });
        return;
      }
      user.homeLocation = geo.location;
    }

    if (parsed.data.scheduleExceptions !== undefined) {
      user.scheduleExceptions = parsed.data.scheduleExceptions;
    }

    await user.save();

    if (email !== undefined && previousEmail !== user.email) {
      await renameEmailPreferences(previousEmail, user.email);
      if (nextIsCustomer || wasCustomer || nextUserType === "staff") {
        await syncCustomersToUserEmail(previousEmail, user.email);
      }
    }

    const nextTerritories = formatTerritories(user.territories);
    const counties = [
      ...new Set([...previousTerritories.counties, ...nextTerritories.counties]),
    ];
    const zips = [
      ...new Set([...previousTerritories.zips, ...nextTerritories.zips]),
    ];
    if (wasOwner || nextIsOwner || counties.length > 0 || zips.length > 0) {
      scheduleOwnerReassignment(`user-update=${String(user._id)}`);
    }

    const fresh = await User.findById(user._id).lean();

    logNotificationAsync({
      entityType: "user",
      action: "updated",
      entityId: String(user._id),
      summary: `User ${user.email} updated`,
      metadata: { email: user.email, role: user.role },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({ user: (await presentUsers([fresh ?? user]))[0] });
  } catch (err) {
    console.error("PATCH /users/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateUserRole(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const assigned = await resolveAssignedRoles(parsed.data);
    if (!assigned.ok) {
      res.status(400).json({ message: assigned.message });
      return;
    }

    const user = await User.findOne({ _id: req.params.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (user.userType === "customer" || isCustomerRole(assigned.roles)) {
      res.status(400).json({
        message: "Customer accounts use the customer role. Change account type instead.",
      });
      return;
    }
    user.roles = assigned.roles;
    user.role = assigned.role;
    await user.save();

    const fresh = await User.findById(user._id).lean();

    logNotificationAsync({
      entityType: "user",
      action: "updated",
      entityId: String(user._id),
      summary: `User roles changed to ${assigned.roles.join(", ")}`,
      metadata: { email: user.email, role: user.role, roles: user.roles },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({ user: (await presentUsers([fresh ?? user]))[0] });
  } catch (err) {
    console.error("PATCH /users/:id/role error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function softDeleteUser(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (String(req.params.id) === req.user.id) {
      res.status(400).json({ message: "You cannot delete your own account" });
      return;
    }

    const user = await User.findOne({ _id: req.params.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const previousUsername = user.username;
    const wasOwner = await userHasCapability(user, "territoryOwner");
    user.deletedAt = new Date();
    // Free unique usernameKey so active users can claim the bare name
    user.usernameKey = null;
    user.username = null;
    user.territories = emptyTerritories();
    await user.save();

    if (wasOwner) {
      scheduleOwnerReassignment(`user-delete=${String(user._id)}`);
    }

    if (previousUsername) {
      const remaining = await User.find({
        username: previousUsername,
        deletedAt: null,
      })
        .sort({ createdAt: 1 })
        .select("_id")
        .limit(1)
        .lean();
      if (remaining[0]) {
        await rebalanceUsernameGroup(previousUsername, remaining[0]._id);
      }
    }

    logNotificationAsync({
      entityType: "user",
      action: "deleted",
      entityId: String(user._id),
      summary: `User ${user.email} deleted`,
      metadata: { email: user.email },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      message: "User deleted",
      user: (await presentUsers([user]))[0],
    });
  } catch (err) {
    console.error("DELETE /users/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
