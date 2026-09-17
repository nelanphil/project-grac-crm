import { Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
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
  isCustomerRole,
  isOwnerRole,
  isSuperAdminRole,
  isTechnicianRole,
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

function formatUser(user: {
  _id: unknown;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  roles?: string[];
  username?: string | null;
  usernameKey?: string | null;
  territories?: IUserTerritories | null;
  schedulable?: boolean;
  homeLocation?: IUserHomeLocation | null;
  weeklyHours?: IWeeklyHours | null;
  scheduleExceptions?: IScheduleException[] | null;
  createdAt: Date;
  updatedAt?: Date;
}) {
  const synced = syncRoleFields(user);
  return {
    _id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: synced.role,
    roles: synced.roles,
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
      users: users.map((u) => formatUser(u)),
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
    const { roles, role } = assigned;
    const isCustomer = isCustomerRole(roles);
    const isOwner = isOwnerRole(roles);
    const isTech = isTechnicianRole(roles);

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
    const softDeleted = await User.findOne({
      email: normalizedEmail,
      deletedAt: { $ne: null },
    });
    const emailConflict = await findEmailConflict(normalizedEmail, {
      excludeUserId: softDeleted?._id ?? null,
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
    if (softDeleted) {
      softDeleted.password_hash = password_hash;
      softDeleted.first_name = first_name;
      softDeleted.last_name = last_name;
      softDeleted.roles = roles;
      softDeleted.role = role;
      softDeleted.territories = territories;
      softDeleted.weeklyHours = weeklyHours;
      softDeleted.homeLocation = homeLocation;
      softDeleted.scheduleExceptions = scheduleExceptions;
      softDeleted.deletedAt = null;
      if (username !== undefined) {
        try {
          await applyUsername(softDeleted, username === "" ? null : username);
        } catch (err) {
          res.status(400).json({
            message: err instanceof Error ? err.message : "Invalid username",
          });
          return;
        }
      }
      await softDeleted.save();
      user = softDeleted;
      restored = true;
    } else {
      user = await User.create({
        email,
        password_hash,
        first_name,
        last_name,
        role,
        roles,
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
      user: formatUser(user),
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

    const wasOwner = isOwnerRole(user);
    const wasCustomer = isCustomerRole(user);
    const wasTech = isTechnicianRole(user);
    const previousTerritories = formatTerritories(user.territories);
    const previousEmail = user.email;

    if (email !== undefined) {
      const emailConflict = await findEmailConflict(email.toLowerCase(), {
        excludeUserId: user._id,
      });
      if (emailConflict) {
        const nextRoles = assigned?.roles ?? user.roles;
        const message =
          isCustomerRole(nextRoles) || emailConflict.type === "customer"
            ? EMAIL_CONFLICT_ADMIN
            : "Email already in use";
        res.status(409).json({ message });
        return;
      }
      user.email = email.toLowerCase();
    }
    if (first_name !== undefined) user.first_name = first_name;
    if (last_name !== undefined) user.last_name = last_name;
    if (assigned) {
      user.roles = assigned.roles;
      user.role = assigned.role;
    }

    const nextIsOwner = isOwnerRole(user);
    const nextIsCustomer = isCustomerRole(user);
    const nextIsTech = isTechnicianRole(user);
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
    }

    if (
      (nextIsCustomer || wasCustomer) &&
      email !== undefined &&
      previousEmail !== user.email
    ) {
      await syncCustomersToUserEmail(previousEmail, user.email);
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

    res.status(200).json({ user: formatUser(fresh ?? user) });
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

    const wasOwner = isOwnerRole(user);
    const wasTech = isTechnicianRole(user);
    user.roles = assigned.roles;
    user.role = assigned.role;
    if (!isOwnerRole(user)) {
      user.territories = emptyTerritories();
    }
    if (!wasTech && isTechnicianRole(user) && weeklyHoursNeverEnabled(user.weeklyHours)) {
      user.weeklyHours = defaultWeeklyHours(true);
    }
    await user.save();

    if (wasOwner || isOwnerRole(user)) {
      scheduleOwnerReassignment(`user-role=${String(user._id)}`);
    }

    const fresh = await User.findById(user._id).lean();

    logNotificationAsync({
      entityType: "user",
      action: "updated",
      entityId: String(user._id),
      summary: `User roles changed to ${assigned.roles.join(", ")}`,
      metadata: { email: user.email, role: user.role, roles: user.roles },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({ user: formatUser(fresh ?? user) });
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
    const wasOwner = isOwnerRole(user);
    const previousTerritories = formatTerritories(user.territories);
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

    res.status(200).json({ message: "User deleted", user: formatUser(user) });
  } catch (err) {
    console.error("DELETE /users/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
