import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  EmailAccount,
  EmailAccountRole,
  IEmailAccount,
} from "../models/mongo/EmailAccount";
import {
  createEmailAccountSchema,
  testEmailAccountSchema,
  updateEmailAccountSchema,
} from "../schemas/emailAccount.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import { sendWithEmailAccount } from "../services/email.service";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

function toPublic(doc: IEmailAccount | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IEmailAccount).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    friendlyName: d.friendlyName,
    host: d.host,
    port: d.port,
    secure: d.secure ?? false,
    username: d.username,
    fromName: d.fromName,
    fromEmail: d.fromEmail,
    isActive: d.isActive ?? true,
    roles: d.roles ?? [],
    hasPassword: Boolean(d.passwordEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** Ensure each role is owned by at most one account. */
async function clearRolesFromOthers(
  roles: EmailAccountRole[],
  exceptId?: string
): Promise<void> {
  if (roles.length === 0) return;

  const filter: Record<string, unknown> = { roles: { $in: roles } };
  if (exceptId) {
    filter._id = { $ne: exceptId };
  }

  await EmailAccount.updateMany(filter, {
    $pull: { roles: { $in: roles } },
  });
}

export async function getEmailAccounts(
  _req: AuthRequest,
  res: Response
): Promise<void> {
  const accounts = await EmailAccount.find().sort({ friendlyName: 1 }).lean();
  res.json({ accounts: accounts.map(toPublic) });
}

export async function createEmailAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const parsed = createEmailAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const existing = await EmailAccount.findOne({
    friendlyName: data.friendlyName,
  });
  if (existing) {
    res.status(409).json({
      message: "An email account with this name already exists",
    });
    return;
  }

  const roles = data.roles ?? [];
  await clearRolesFromOthers(roles);

  const port = data.port;
  const secure = port === 465 ? true : data.secure;

  const account = await EmailAccount.create({
    friendlyName: data.friendlyName,
    host: data.host,
    port,
    secure,
    username: data.username,
    passwordEncrypted: encryptCredential(data.password),
    fromName: data.fromName,
    fromEmail: data.fromEmail.toLowerCase(),
    isActive: data.isActive ?? true,
    roles,
  });

  logNotificationAsync({
    entityType: "email_account",
    action: "created",
    entityId: String(account._id),
    summary: `Email account ${data.friendlyName} created`,
    metadata: { friendlyName: data.friendlyName, roles },
    ...actorFromRequest(req.user),
  });

  res.status(201).json({ account: toPublic(account) });
}

export async function updateEmailAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const parsed = updateEmailAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const account = await EmailAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Email account not found" });
    return;
  }

  const data = parsed.data;

  if (data.friendlyName && data.friendlyName !== account.friendlyName) {
    const conflict = await EmailAccount.findOne({
      friendlyName: data.friendlyName,
    });
    if (conflict) {
      res.status(409).json({
        message: "An email account with this name already exists",
      });
      return;
    }
    account.friendlyName = data.friendlyName;
  }

  if (data.host !== undefined) account.host = data.host;
  if (data.port !== undefined) account.port = data.port;
  if (data.secure !== undefined) account.secure = data.secure;
  // Port 465 is always implicit TLS
  if (account.port === 465) account.secure = true;
  if (data.username !== undefined) account.username = data.username;
  if (data.fromName !== undefined) account.fromName = data.fromName;
  if (data.fromEmail !== undefined) {
    account.fromEmail = data.fromEmail.toLowerCase();
  }
  if (data.isActive !== undefined) account.isActive = data.isActive;

  if (data.password !== undefined && data.password.trim() !== "") {
    account.passwordEncrypted = encryptCredential(data.password);
  }

  if (data.roles !== undefined) {
    await clearRolesFromOthers(data.roles, String(account._id));
    account.roles = data.roles;
  }

  await account.save();

  logNotificationAsync({
    entityType: "email_account",
    action: "updated",
    entityId: String(account._id),
    summary: `Email account ${account.friendlyName} updated`,
    metadata: { friendlyName: account.friendlyName, roles: account.roles },
    ...actorFromRequest(req.user),
  });

  res.json({ account: toPublic(account) });
}

export async function deleteEmailAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const account = await EmailAccount.findByIdAndDelete(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Email account not found" });
    return;
  }

  logNotificationAsync({
    entityType: "email_account",
    action: "deleted",
    entityId: String(account._id),
    summary: `Email account ${account.friendlyName} deleted`,
    metadata: { friendlyName: account.friendlyName },
    ...actorFromRequest(req.user),
  });

  res.json({ message: "Email account deleted" });
}

/** POST /email-accounts/:id/test — send a real test message via this account. */
export async function testEmailAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const parsed = testEmailAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const account = await EmailAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Email account not found" });
    return;
  }

  if (!account.isActive) {
    res.status(400).json({ message: "Email account is inactive" });
    return;
  }

  if (!account.passwordEncrypted) {
    res.status(400).json({ message: "Email account has no SMTP password set" });
    return;
  }

  const to = parsed.data.to.toLowerCase();
  const sentAt = new Date().toISOString();

  try {
    const result = await sendWithEmailAccount(account, {
      to,
      subject: `[GRAC CRM] Test email from ${account.friendlyName}`,
      text: `This is a test email from GRAC CRM Control Panel.\n\nAccount: ${account.friendlyName}\nFrom: ${account.fromName} <${account.fromEmail}>\nSMTP: ${account.host}:${account.port} (secure=${account.port === 465 ? true : account.secure})\nSent at: ${sentAt}\n\nIf you received this, SMTP accepted and delivered the message to your mailbox provider.`,
      html: `<p>This is a test email from <strong>GRAC CRM Control Panel</strong>.</p><ul><li>Account: ${account.friendlyName}</li><li>From: ${account.fromName} &lt;${account.fromEmail}&gt;</li><li>SMTP: ${account.host}:${account.port}</li><li>Sent at: ${sentAt}</li></ul><p>If you received this, SMTP accepted and delivered the message to your mailbox provider.</p>`,
    });

    console.info("[mail] Control Panel test email accepted by SMTP:", {
      accountId: String(account._id),
      to,
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
      response: result.response,
      from: result.from,
      host: result.host,
      port: result.port,
      secure: result.secure,
    });

    res.json({
      message:
        "SMTP accepted the test message. Check the inbox (and spam) for delivery — acceptance is not the same as inbox delivery.",
      result: {
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
        response: result.response,
        from: result.from,
        to: result.to,
        host: result.host,
        port: result.port,
        secure: result.secure,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "SMTP send failed";
    console.error("[mail] Control Panel test email failed:", err);
    res.status(502).json({
      message: `SMTP rejected or failed the test send: ${detail}`,
    });
  }
}
