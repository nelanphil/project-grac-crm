import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { getPermissionsForRoles } from "../models/mongo/RolePermission";
import { User, activeUserFilter } from "../models/mongo/User";
import { verifyRecordingPlaybackToken } from "../utils/recordingPlayback";
import { hasRole, normalizeRoles, primaryRole, type UserType } from "../utils/roles";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: string;
  roles?: string[];
  userType?: UserType;
  jobRoles?: string[];
  permissions: string[];
}

export interface AuthRequest extends Request {
  user?: AuthTokenPayload & {
    id: string;
    roles: string[];
    userType: UserType;
    jobRoles: string[];
  };
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, env.jwt.secret) as unknown as AuthTokenPayload;
    const dbUser = await User.findOne({
      _id: decoded.sub,
      ...activeUserFilter,
    })
      .select("email role roles userType jobRoles")
      .lean();
    if (!dbUser) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }
    const roles = normalizeRoles(dbUser);
    const userType: UserType =
      dbUser.userType === "customer" ? "customer" : "staff";
    // Always load current roles and permissions from DB so job-role and
    // permission changes apply without forcing users to log in again.
    const permissions = await getPermissionsForRoles(roles);
    req.user = {
      ...decoded,
      id: decoded.sub,
      email: dbUser.email,
      role: primaryRole(roles) ?? dbUser.role,
      roles,
      userType,
      jobRoles: (dbUser.jobRoles ?? []).map((id) => String(id)),
      permissions,
    };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

/**
 * Attaches the user when a valid Bearer token is present.
 * Missing or invalid tokens continue as anonymous so public ingest
 * (crash reports) is not blocked by a stale session.
 */
export async function authenticateIfPresent(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, env.jwt.secret) as unknown as AuthTokenPayload;
    const dbUser = await User.findOne({
      _id: decoded.sub,
      ...activeUserFilter,
    })
      .select("email role roles userType jobRoles")
      .lean();
    if (!dbUser) {
      next();
      return;
    }
    const roles = normalizeRoles(dbUser);
    const userType: UserType =
      dbUser.userType === "customer" ? "customer" : "staff";
    const permissions = await getPermissionsForRoles(roles);
    req.user = {
      ...decoded,
      id: decoded.sub,
      email: dbUser.email,
      role: primaryRole(roles) ?? dbUser.role,
      roles,
      userType,
      jobRoles: (dbUser.jobRoles ?? []).map((id) => String(id)),
      permissions,
    };
  } catch {
    // Ignore invalid tokens and store the report as anonymous.
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (!hasRole(req.user, ...roles)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return requireAnyPermission(permission);
}

export function requireAnyPermission(...permissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (!permissions.some((permission) => req.user!.permissions.includes(permission))) {
      res.status(403).json({
        message: `Missing permission: ${permissions.join(" or ")}`,
      });
      return;
    }
    next();
  };
}

/**
 * GET recording: HTML <audio> cannot send Authorization, so a short-lived
 * signed query token is accepted. Bearer JWT + messages:read also works.
 */
export async function authenticateRecordingPlayback(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const commId = String(req.params.id || "");
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";

  if (queryToken) {
    if (verifyRecordingPlaybackToken(queryToken, commId)) {
      next();
      return;
    }
    res.status(403).json({ message: "Invalid or expired recording token" });
    return;
  }

  await authenticate(req, res, () => {
    requireRole("admin", "super-admin")(req, res, () => {
      requirePermission("messages:read")(req, res, next);
    });
  });
}
