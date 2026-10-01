import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import {
  coordinatesSchema,
  loginSchema,
  registerSchema,
  legalConsentSchema,
  updateProfileSchema,
  updatePasswordSchema,
  navOrderSchema,
  updateNotificationsSchema,
  LEGAL_DOCS_VERSION,
} from "../schemas/auth.schema";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../schemas/user.schema";
import { User, UserRole, activeUserFilter } from "../models/mongo/User";
import { findPrimaryContactForUserEmail } from "../utils/resolveCustomerLogin";
import { PasswordResetToken } from "../models/mongo/PasswordResetToken";
import { getPermissionsForRoles } from "../models/mongo/RolePermission";
import { AuthRequest } from "../middleware/auth.middleware";
import { normalizePhoneDigits } from "../utils/customerSites";
import {
  buildLoginUrl,
  buildPasswordResetUrl,
  isRoleMailConfigured,
  sendRoleEmail,
} from "../services/email.service";
import {
  buildPasswordResetEmail,
  buildSignupWelcomeEmail,
} from "../utils/emailTemplates";
import {
  applyUsername,
  normalizeUsername,
  previewUsernameAssignment,
  usernameNumberFromKey,
} from "../utils/username";
import {
  EMAIL_CONFLICT_SIGNUP,
  findEmailConflict,
  provisionCrmCustomerForUser,
} from "../utils/provisionCustomerAccount";
import { syncCustomersToUserEmail } from "../utils/ensureCustomerLogin";
import {
  lookupLoginLocation,
  reverseGeocodeLocation,
} from "../utils/loginLocation";
import {
  getEmailPreferences,
  renameEmailPreferences,
  setEmailPreferences,
} from "../utils/emailPreferences";
import { capabilitiesForJobRoleIds, homeViewForJobRoleIds, slugsForJobRoleIds } from "../utils/jobRoles";
import {
  isCustomerRole,
  normalizeRoles,
  primaryRole,
  type UserType,
} from "../utils/roles";

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildUserPayload(user: {
  _id: unknown;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  roles?: UserRole[];
  userType?: UserType | null;
  jobRoles?: unknown[] | null;
  jobRoleSlugs?: string[] | null;
  homeView?: "default" | "todo" | null;
  capabilities?: { schedulable: boolean; territoryOwner: boolean };
  username?: string | null;
  usernameKey?: string | null;
  termsAcceptedAt?: Date | string | null;
  privacyAcceptedAt?: Date | string | null;
  smsOptIn?: boolean;
  smsOptInAt?: Date | string | null;
  phone?: string | null;
  legalDocsVersion?: string | null;
  uiPreferences?: {
    navOrder?: {
      order: string[];
      children: Record<string, string[]>;
      hidden?: string[];
    };
  };
  permissions: string[];
}) {
  const termsAcceptedAt = toIsoOrNull(user.termsAcceptedAt);
  const roles = normalizeRoles(user);
  const userType: UserType =
    user.userType === "customer" || isCustomerRole(roles) ? "customer" : "staff";
  const jobRoles = (user.jobRoles ?? []).map((id) => String(id));
  return {
    id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: userType === "customer" ? "customer" : (primaryRole(roles) ?? user.role),
    roles: userType === "customer" ? ["customer"] : roles,
    userType,
    jobRoles: userType === "customer" ? [] : jobRoles,
    jobRoleSlugs:
      userType === "customer" ? [] : (user.jobRoleSlugs ?? []),
    homeView: userType === "customer" ? "default" : (user.homeView ?? "default"),
    capabilities: user.capabilities ?? {
      schedulable: false,
      territoryOwner: false,
    },
    username: user.username ?? null,
    usernameNumber: usernameNumberFromKey(user.username, user.usernameKey),
    permissions: user.permissions,
    termsAcceptedAt,
    privacyAcceptedAt: toIsoOrNull(user.privacyAcceptedAt),
    smsOptIn: Boolean(user.smsOptIn),
    smsOptInAt: toIsoOrNull(user.smsOptInAt),
    phone: (user.phone ?? "").trim() || null,
    legalDocsVersion: user.legalDocsVersion ?? null,
    uiPreferences: {
      navOrder: {
        order: user.uiPreferences?.navOrder?.order ?? [],
        children: user.uiPreferences?.navOrder?.children ?? {},
        hidden: user.uiPreferences?.navOrder?.hidden ?? [],
      },
    },
    needsLegalConsent: isCustomerRole(roles) && !termsAcceptedAt,
    generalNotifications: true,
    billingAlerts: true,
  };
}

async function permissionsForUser(user: {
  role?: string;
  roles?: string[];
}): Promise<string[]> {
  return getPermissionsForRoles(normalizeRoles(user));
}

async function lookupContactPhone(userEmail: string | null | undefined): Promise<string> {
  const contact = await findPrimaryContactForUserEmail(userEmail);
  return (contact?.phone ?? "").trim();
}

async function toUserPayload(
  user: Parameters<typeof buildUserPayload>[0] & {
    _id: unknown;
    phone?: string | null;
  },
) {
  const own = (user.phone ?? "").trim();
  const phone = own || (await lookupContactPhone(user.email));
  const prefs = await getEmailPreferences(user.email);
  const jobRoles = (user.jobRoles ?? []).map((id) => String(id));
  const [capabilities, jobRoleSlugs, homeView] = await Promise.all([
    capabilitiesForJobRoleIds(jobRoles),
    slugsForJobRoleIds(jobRoles),
    homeViewForJobRoleIds(jobRoles),
  ]);
  return {
    ...buildUserPayload({
      ...user,
      phone,
      jobRoles,
      jobRoleSlugs,
      homeView,
      capabilities,
    }),
    generalNotifications: prefs.generalNotifications,
    billingAlerts: prefs.billingAlerts,
  };
}

async function syncEmptyContactPhone(
  userEmail: string | null | undefined,
  phone: string,
): Promise<void> {
  const digits = normalizePhoneDigits(phone);
  if (digits.length !== 10) return;
  const contact = await findPrimaryContactForUserEmail(userEmail);
  if (!contact) return;
  if (normalizePhoneDigits(contact.phone)) return;
  contact.phone = phone.trim();
  await contact.save();
}

function applyLegalConsent(
  user: {
    termsAcceptedAt: Date | null;
    privacyAcceptedAt: Date | null;
    smsOptIn: boolean;
    smsOptInAt: Date | null;
    legalDocsVersion: string | null;
  },
  smsOptIn: boolean,
) {
  const now = new Date();
  user.termsAcceptedAt = now;
  user.privacyAcceptedAt = now;
  user.legalDocsVersion = LEGAL_DOCS_VERSION;
  user.smsOptIn = smsOptIn;
  user.smsOptInAt = smsOptIn ? now : null;
}

const LOGIN_FAIL = { message: "Invalid email/username or password" };
const LOGIN_AMBIGUOUS = {
  message:
    "This username is shared. Sign in with your username and number (e.g. doc1), or use your email.",
};
const LOCATION_REQUIRED = {
  code: "LOCATION_REQUIRED",
  message:
    "Staff sign-in requires location access. Allow location for this site in your browser, then sign in again.",
};

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password, first_name, last_name, smsOptIn, phone } =
    parsed.data;
  const role = "customer";

  try {
    const normalizedEmail = email.toLowerCase();
    const softDeleted = await User.findOne({
      email: normalizedEmail,
      deletedAt: { $ne: null },
    });
    const emailConflict = await findEmailConflict(normalizedEmail, {
      excludeUserId: softDeleted?._id ?? null,
    });
    if (emailConflict) {
      res.status(409).json({ message: EMAIL_CONFLICT_SIGNUP });
      return;
    }

    // Soft-deleted account with same email: restore instead of duplicating
    if (softDeleted) {
      softDeleted.password_hash = await bcrypt.hash(password, 10);
      softDeleted.first_name = first_name;
      softDeleted.last_name = last_name;
      softDeleted.userType = "customer";
      softDeleted.role = role;
      softDeleted.roles = ["customer"];
      softDeleted.deletedAt = null;
      applyLegalConsent(softDeleted, smsOptIn);
      if (phone) softDeleted.phone = phone;
      await softDeleted.save();

      try {
        await provisionCrmCustomerForUser(softDeleted, { phone });
      } catch (err) {
        console.error("register CRM provision error:", err);
        res.status(500).json({ message: "Internal server error" });
        return;
      }

      const permissions = await permissionsForUser(softDeleted);
      void sendSignupConfirmationEmail({
        email: softDeleted.email,
        firstName: softDeleted.first_name,
      });
      res.status(201).json({
        message: "User registered successfully",
        user: await toUserPayload({ ...softDeleted.toObject(), permissions }),
      });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const now = new Date();
    const user = await User.create({
      email,
      password_hash,
      first_name,
      last_name,
      role,
      roles: ["customer"],
      userType: "customer",
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      legalDocsVersion: LEGAL_DOCS_VERSION,
      smsOptIn,
      smsOptInAt: smsOptIn ? now : null,
      phone: phone || "",
    });

    try {
      await provisionCrmCustomerForUser(user, { phone });
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }

    const permissions = await permissionsForUser(user);
    void sendSignupConfirmationEmail({
      email: user.email,
      firstName: user.first_name,
    });
    res.status(201).json({
      message: "User registered successfully",
      user: await toUserPayload({ ...user.toObject(), permissions }),
    });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

async function sendSignupConfirmationEmail(opts: {
  email: string;
  firstName: string;
}): Promise<void> {
  const loginUrl = buildLoginUrl();
  const mail = buildSignupWelcomeEmail({
    firstName: opts.firstName,
    loginUrl,
  });
  try {
    const mailResult = await sendRoleEmail("general_notifications", {
      to: opts.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    console.info("[mail] Signup confirmation email accepted by SMTP:", {
      to: opts.email,
      messageId: mailResult.messageId,
      accepted: mailResult.accepted,
      rejected: mailResult.rejected,
      response: mailResult.response,
      from: mailResult.from,
      host: mailResult.host,
      port: mailResult.port,
    });
  } catch (err) {
    console.error("[mail] Failed to send signup confirmation email:", err);
  }
}

/** POST /auth/legal-consent — first-login terms / privacy / SMS for customers */
export async function acceptLegalConsent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = legalConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    applyLegalConsent(user, parsed.data.smsOptIn);
    if (parsed.data.phone) user.phone = parsed.data.phone;
    await user.save();

    if (isCustomerRole(user) && parsed.data.phone) {
      await syncEmptyContactPhone(user.email, parsed.data.phone);
    }

    const permissions = await permissionsForUser(user);
    res.status(200).json({
      user: await toUserPayload({ ...user.toObject(), permissions }),
    });
  } catch (err) {
    console.error("acceptLegalConsent error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { identifier, password, location } = parsed.data;
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

    if (!isCustomerRole(matchedUser) && !location) {
      res.status(403).json(LOCATION_REQUIRED);
      return;
    }

    const lastLoginAt = new Date();
    const deviceLocation = location
      ? await reverseGeocodeLocation(location.lat, location.lng)
      : null;
    const lastLoginLocation =
      deviceLocation ?? (await lookupLoginLocation(req.ip));
    await User.updateOne(
      { _id: matchedUser._id },
      { $set: { lastLoginAt, lastLoginLocation } },
    );

    const permissions = await permissionsForUser(matchedUser);

    const token = jwt.sign(
      {
        sub: String(matchedUser._id),
        email: matchedUser.email,
        role: primaryRole(matchedUser) ?? matchedUser.role,
        roles: normalizeRoles(matchedUser),
        permissions,
      },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn } as jwt.SignOptions,
    );

    res.status(200).json({
      token,
      user: await toUserPayload({ ...matchedUser.toObject(), permissions }),
    });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** POST /auth/me/login-location — refresh the city for the current session. Does not change lastLoginAt. */
export async function updateLoginLocation(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = coordinatesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const location = await reverseGeocodeLocation(parsed.data.lat, parsed.data.lng);
    if (location) {
      await User.updateOne(
        { _id: req.user.id, ...activeUserFilter },
        { $set: { lastLoginLocation: location } },
      );
    }
    res.status(204).end();
  } catch (err) {
    console.error("POST /auth/me/login-location error:", err);
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
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { first_name, last_name, email, username } = parsed.data;

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const previousEmail = user.email;
    if (email) {
      const emailConflict = await findEmailConflict(email.toLowerCase(), {
        excludeUserId: user._id,
      });
      if (emailConflict) {
        res.status(409).json({
          message:
            isCustomerRole(user) || emailConflict.type === "customer"
              ? EMAIL_CONFLICT_SIGNUP
              : "Email already in use",
        });
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

    if (email && previousEmail !== user.email) {
      await renameEmailPreferences(previousEmail, user.email);
    }

    if (
      isCustomerRole(user) &&
      email &&
      previousEmail !== user.email
    ) {
      await syncCustomersToUserEmail(previousEmail, user.email);
    }

    // Always read back so usernameNumber matches rebalanced keys in DB
    const fresh = await User.findById(user._id).lean();
    if (!fresh) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const permissions = await permissionsForUser(fresh);
    res.status(200).json({
      user: await toUserPayload({ ...fresh, permissions }),
    });
  } catch (err) {
    console.error("updateMe error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** GET /auth/username-check?username=foo — live preview before save */
export async function checkUsername(
  req: AuthRequest,
  res: Response,
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

    const raw =
      typeof req.query.username === "string" ? req.query.username : "";
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

export async function updatePassword(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = updatePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
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

export async function updateMyNotifications(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = updateNotificationsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await User.findOne({ _id: req.user.id, ...activeUserFilter });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (parsed.data.smsOptIn !== undefined) {
      if (
        parsed.data.smsOptIn &&
        normalizePhoneDigits(user.phone).length !== 10
      ) {
        const contactPhone = await lookupContactPhone(user.email);
        if (normalizePhoneDigits(contactPhone).length !== 10) {
          res.status(400).json({
            message:
              "A valid 10-digit mobile number is required to opt in to text messages",
          });
          return;
        }
      }
      user.smsOptIn = parsed.data.smsOptIn;
      user.smsOptInAt = parsed.data.smsOptIn ? new Date() : null;
      await user.save();
    }

    if (
      parsed.data.generalNotifications !== undefined ||
      parsed.data.billingAlerts !== undefined
    ) {
      await setEmailPreferences(user.email, {
        generalNotifications: parsed.data.generalNotifications,
        billingAlerts: parsed.data.billingAlerts,
      });
    }

    const permissions = await permissionsForUser(user);
    res.status(200).json({
      user: await toUserPayload({ ...user.toObject(), permissions }),
    });
  } catch (err) {
    console.error("updateMyNotifications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const user = await User.findOne({
      _id: req.user.id,
      ...activeUserFilter,
    }).lean();
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const permissions = await permissionsForUser(user);

    res.status(200).json({
      user: await toUserPayload({ ...user, permissions }),
    });
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateMyNavOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = navOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await User.findOneAndUpdate(
      { _id: req.user.id, ...activeUserFilter },
      { $set: { "uiPreferences.navOrder": parsed.data } },
      { new: true },
    ).lean();
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res
      .status(200)
      .json({
        navOrder: user.uiPreferences?.navOrder ?? {
          ...parsed.data,
          hidden: parsed.data.hidden ?? [],
        },
      });
  } catch (err) {
    console.error("updateMyNavOrder error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
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
  const okMessage =
    "If an account exists for that email, password reset instructions have been sent.";

  try {
    const user = await User.findOne({ email, ...activeUserFilter });
    if (!user) {
      res.status(200).json({ message: okMessage });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    const resetUrl = buildPasswordResetUrl(rawToken);
    const exposeDevLink = process.env.NODE_ENV !== "production";
    let mailSent = false;
    let mailError: string | undefined;

    const mailReady = await isRoleMailConfigured("general_notifications");
    if (!mailReady) {
      mailError =
        "No General notifications email account is configured (and no env SMTP fallback).";
      console.warn(`[mail] ${mailError}`);
      console.warn(`[mail] Dev reset URL for ${user.email}: ${resetUrl}`);
    } else {
      try {
        const mail = buildPasswordResetEmail(resetUrl);
        const mailResult = await sendRoleEmail("general_notifications", {
          to: user.email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
        mailSent = true;
        console.info("[mail] Password reset email accepted by SMTP:", {
          to: user.email,
          messageId: mailResult.messageId,
          accepted: mailResult.accepted,
          rejected: mailResult.rejected,
          response: mailResult.response,
          from: mailResult.from,
          host: mailResult.host,
          port: mailResult.port,
          secure: mailResult.secure,
          accountId: mailResult.accountId,
          friendlyName: mailResult.friendlyName,
        });
      } catch (mailErr) {
        mailError =
          mailErr instanceof Error ? mailErr.message : "SMTP send failed";
        console.error("[mail] Failed to send password reset email:", mailErr);
        console.warn(
          `[mail] Fallback reset URL for ${user.email}: ${resetUrl}`,
        );
      }
    }

    res.status(200).json({
      message: okMessage,
      // Only expose the link outside production so local/dev can finish the flow
      // without SMTP. Never include this in production responses.
      ...(exposeDevLink && !mailSent
        ? { devResetUrl: resetUrl, mailError }
        : {}),
    });
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
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

    const user = await User.findOne({
      _id: record.userId,
      ...activeUserFilter,
    });
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
      { $set: { usedAt: new Date() } },
    );

    res.status(200).json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
