import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { getPermissionsForRole } from "../models/mongo/RolePermission";
import { verifyRecordingPlaybackToken } from "../utils/recordingPlayback";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
}

export interface AuthRequest extends Request {
  user?: AuthTokenPayload & { id: string };
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
    // Always load current role permissions from DB so newly seeded grants
    // (e.g. messages:*) apply without forcing users to log in again.
    const permissions = await getPermissionsForRole(decoded.role);
    req.user = { ...decoded, id: decoded.sub, permissions };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (!req.user.permissions.includes(permission)) {
      res.status(403).json({ message: `Missing permission: ${permission}` });
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
    requireRole("admin", "super-admin", "owner")(req, res, () => {
      requirePermission("messages:read")(req, res, next);
    });
  });
}
