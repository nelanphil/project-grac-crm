import { Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { AuthRequest } from "../middleware/auth.middleware";
import { User, activeUserFilter } from "../models/mongo/User";
import { Role } from "../models/mongo/Role";
import { createUserSchema, updateUserSchema } from "../schemas/user.schema";
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

function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function formatUser(user: {
  _id: unknown;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  username?: string | null;
  usernameKey?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}) {
  return {
    _id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    username: user.username ?? null,
    usernameNumber: usernameNumberFromKey(user.username, user.usernameKey),
    createdAt: user.createdAt,
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
  };
}

async function assertRoleExists(roleSlug: string): Promise<boolean> {
  const role = await Role.findOne({ slug: roleSlug, deletedAt: null }).lean();
  return Boolean(role);
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

  const { email, first_name, last_name, role, username } = parsed.data;
  const plainPassword = parsed.data.password ?? generateTempPassword();
  const passwordWasGenerated = !parsed.data.password;

  try {
    if (!(await assertRoleExists(role))) {
      res.status(400).json({ message: "Invalid or deleted role" });
      return;
    }

    const activeExisting = await User.findOne({
      email: email.toLowerCase(),
      ...activeUserFilter,
    }).lean();
    if (activeExisting) {
      res.status(409).json({ message: "Email already in use" });
      return;
    }

    const password_hash = await bcrypt.hash(plainPassword, 10);

    const softDeleted = await User.findOne({
      email: email.toLowerCase(),
      deletedAt: { $ne: null },
    });

    let user;
    if (softDeleted) {
      softDeleted.password_hash = password_hash;
      softDeleted.first_name = first_name;
      softDeleted.last_name = last_name;
      softDeleted.role = role;
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
    } else {
      user = await User.create({
        email,
        password_hash,
        first_name,
        last_name,
        role,
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

  const { email, first_name, last_name, role, username, password } = parsed.data;

  try {
    if (password !== undefined && req.user?.role !== "super-admin") {
      res.status(403).json({ message: "Only super-admins can set user passwords" });
      return;
    }

    if (role !== undefined && !(await assertRoleExists(role))) {
      res.status(400).json({ message: "Invalid or deleted role" });
      return;
    }

    const user = await User.findOne({ _id: req.params.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (email !== undefined) {
      const conflict = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: user._id },
        ...activeUserFilter,
      }).lean();
      if (conflict) {
        res.status(409).json({ message: "Email already in use" });
        return;
      }
      user.email = email.toLowerCase();
    }
    if (first_name !== undefined) user.first_name = first_name;
    if (last_name !== undefined) user.last_name = last_name;
    if (role !== undefined) user.role = role;

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

    await user.save();

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
    if (!(await assertRoleExists(parsed.data.role))) {
      res.status(400).json({ message: "Invalid or deleted role" });
      return;
    }

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, ...activeUserFilter },
      { role: parsed.data.role },
      { new: true, select: "-password_hash" }
    ).lean();

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    logNotificationAsync({
      entityType: "user",
      action: "updated",
      entityId: String(user._id),
      summary: `User role changed to ${parsed.data.role}`,
      metadata: { email: user.email, role: user.role },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({ user: formatUser(user) });
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
    user.deletedAt = new Date();
    // Free unique usernameKey so active users can claim the bare name
    user.usernameKey = null;
    user.username = null;
    await user.save();

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
