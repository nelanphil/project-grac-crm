import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { loginSchema, registerSchema, updateProfileSchema, updatePasswordSchema } from "../schemas/auth.schema";
import { User, UserRole } from "../models/mongo/User";
import { getPermissionsForRole } from "../models/mongo/RolePermission";
import { AuthRequest } from "../middleware/auth.middleware";

function buildUserPayload(user: {
  _id: unknown;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  permissions: string[];
}) {
  return {
    id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    permissions: user.permissions,
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password, first_name, last_name, role } = parsed.data;

  try {
    const existing = await User.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      res.status(409).json({ message: "Email already in use" });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password_hash, first_name, last_name, role });

    res.status(201).json({
      message: "User registered successfully",
      user: { id: String(user._id), email: user.email, first_name, last_name, role },
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

  const { email, password } = parsed.data;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }

    const permissions = await getPermissionsForRole(user.role);

    const token = jwt.sign(
      { sub: String(user._id), email: user.email, role: user.role, permissions },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn } as jwt.SignOptions
    );

    res.status(200).json({
      token,
      user: buildUserPayload({ ...user.toObject(), permissions }),
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

  const { first_name, last_name, email } = parsed.data;

  try {
    if (email) {
      const conflict = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user.id } }).lean();
      if (conflict) {
        res.status(409).json({ message: "Email already in use" });
        return;
      }
    }

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { ...(first_name && { first_name }), ...(last_name && { last_name }), ...(email && { email: email.toLowerCase() }) },
      { new: true }
    ).lean();

    if (!updated) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const permissions = await getPermissionsForRole(updated.role);
    res.status(200).json({ user: buildUserPayload({ ...updated, permissions }) });
  } catch (err) {
    console.error("updateMe error:", err);
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
    const user = await User.findById(req.user.id);
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
    const user = await User.findById(req.user.id).lean();
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
