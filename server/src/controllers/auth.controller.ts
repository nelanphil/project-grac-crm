import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { loginSchema, registerSchema, updateProfileSchema, updatePasswordSchema } from "../schemas/auth.schema";
import { forgotPasswordSchema, resetPasswordSchema } from "../schemas/user.schema";
import { User, UserRole, activeUserFilter } from "../models/mongo/User";
import { PasswordResetToken } from "../models/mongo/PasswordResetToken";
import { getPermissionsForRole } from "../models/mongo/RolePermission";
import { AuthRequest } from "../middleware/auth.middleware";
import { buildPasswordResetUrl, sendMail } from "../utils/mail";
import {
  applyUsername,
  normalizeUsername,
  previewUsernameAssignment,
  usernameNumberFromKey,
} from "../utils/username";

function buildUserPayload(user: {
  _id: unknown;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  username?: string | null;
  usernameKey?: string | null;
  permissions: string[];
}) {
  return {
    id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    username: user.username ?? null,
    usernameNumber: usernameNumberFromKey(user.username, user.usernameKey),
    permissions: user.permissions,
  };
}

const LOGIN_FAIL = { message: "Invalid email/username or password" };
const LOGIN_AMBIGUOUS = {
  message:
    "This username is shared. Sign in with your username and number (e.g. doc1), or use your email.",
};

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password, first_name, last_name, role } = parsed.data;

  try {
    const existing = await User.findOne({
      email: email.toLowerCase(),
      ...activeUserFilter,
    }).lean();
    if (existing) {
      res.status(409).json({ message: "Email already in use" });
      return;
    }

    // Soft-deleted account with same email: restore instead of duplicating
    const softDeleted = await User.findOne({
      email: email.toLowerCase(),
      deletedAt: { $ne: null },
    });
    if (softDeleted) {
      softDeleted.password_hash = await bcrypt.hash(password, 10);
      softDeleted.first_name = first_name;
      softDeleted.last_name = last_name;
      softDeleted.role = role;
      softDeleted.deletedAt = null;
      await softDeleted.save();

      res.status(201).json({
        message: "User registered successfully",
        user: {
          id: String(softDeleted._id),
          email: softDeleted.email,
          first_name,
          last_name,
          role,
          username: softDeleted.username ?? null,
          usernameNumber: usernameNumberFromKey(
            softDeleted.username,
            softDeleted.usernameKey
          ),
        },
      });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password_hash, first_name, last_name, role });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: String(user._id),
        email: user.email,
        first_name,
        last_name,
        role,
        username: user.username ?? null,
        usernameNumber: usernameNumberFromKey(user.username, user.usernameKey),
      },
    });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { identifier, password } = parsed.data;
  const trimmed = identifier.trim();

  try {
    let matchedUser = null;

    if (trimmed.includes("@")) {
      const user = await User.findOne({
        email: trimmed.toLowerCase(),
        ...activeUserFilter,
      });
      if (user && (await bcrypt.compare(password, user.password_hash))) {
        matchedUser = user;
      }
    } else {
      const handle = normalizeUsername(trimmed);

      // Exact backend key (doc1) — always unique
      const byKey = await User.findOne({
        usernameKey: handle,
        ...activeUserFilter,
      });
      if (byKey) {
        if (await bcrypt.compare(password, byKey.password_hash)) {
          matchedUser = byKey;
        }
      } else {
        const candidates = await User.find({
          username: handle,
          ...activeUserFilter,
        });

        if (candidates.length > 1) {
          res.status(401).json(LOGIN_AMBIGUOUS);
          return;
        }

        if (
          candidates.length === 1 &&
          (await bcrypt.compare(password, candidates[0].password_hash))
        ) {
          matchedUser = candidates[0];
        }
      }
    }

    if (!matchedUser) {
      res.status(401).json(LOGIN_FAIL);
      return;
    }

    const permissions = await getPermissionsForRole(matchedUser.role);

    const token = jwt.sign(
      {
        sub: String(matchedUser._id),
        email: matchedUser.email,
        role: matchedUser.role,
        permissions,
      },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn } as jwt.SignOptions
    );

    res.status(200).json({
      token,
      user: buildUserPayload({ ...matchedUser.toObject(), permissions }),
    });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateMe(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { first_name, last_name, email, username } = parsed.data;

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (email) {
      const conflict = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: req.user.id },
        ...activeUserFilter,
      }).lean();
      if (conflict) {
        res.status(409).json({ message: "Email already in use" });
        return;
      }
      user.email = email.toLowerCase();
    }
    if (first_name) user.first_name = first_name;
    if (last_name) user.last_name = last_name;

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

    await user.save();

    // Always read back so usernameNumber matches rebalanced keys in DB
    const fresh = await User.findById(user._id).lean();
    if (!fresh) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const permissions = await getPermissionsForRole(fresh.role);
    res.status(200).json({
      user: buildUserPayload({ ...fresh, permissions }),
    });
  } catch (err) {
    console.error("updateMe error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** GET /auth/username-check?username=foo — live preview before save */
export async function checkUsername(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter })
      .select("_id createdAt")
      .lean();
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const raw = typeof req.query.username === "string" ? req.query.username : "";
    const preview = await previewUsernameAssignment(raw, {
      _id: String(user._id),
      createdAt: user.createdAt,
    });

    res.status(200).json(preview);
  } catch (err) {
    console.error("checkUsername error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updatePassword(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = updatePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { current_password, new_password } = parsed.data;

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      res.status(401).json({ message: "Current password is incorrect" });
      return;
    }

    user.password_hash = await bcrypt.hash(new_password, 10);
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("updatePassword error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter }).lean();
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const permissions = await getPermissionsForRole(user.role);

    res.status(200).json({
      user: buildUserPayload({ ...user, permissions }),
    });
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const email = parsed.data.email.toLowerCase();

  // Always return the same message to avoid account enumeration
  const okMessage = {
    message:
      "If an account exists for that email, password reset instructions have been sent.",
  };

  try {
    const user = await User.findOne({ email, ...activeUserFilter });
    if (!user) {
      res.status(200).json(okMessage);
      return;
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    const resetUrl = buildPasswordResetUrl(rawToken);
    await sendMail({
      to: user.email,
      subject: "Reset your GRAC CRM password",
      text: `Reset your password using this link (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Reset your password using this link (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    });

    res.status(200).json(okMessage);
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { token, password } = parsed.data;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  try {
    const record = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      res.status(400).json({ message: "Invalid or expired reset token" });
      return;
    }

    const user = await User.findOne({ _id: record.userId, ...activeUserFilter });
    if (!user) {
      res.status(400).json({ message: "Invalid or expired reset token" });
      return;
    }

    user.password_hash = await bcrypt.hash(password, 10);
    await user.save();

    record.usedAt = new Date();
    await record.save();

    // Invalidate any other outstanding tokens for this user
    await PasswordResetToken.updateMany(
      { userId: user._id, usedAt: null, _id: { $ne: record._id } },
      { $set: { usedAt: new Date() } }
    );

    res.status(200).json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
