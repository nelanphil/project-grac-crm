import nodemailer from "nodemailer";
import {
  EmailAccount,
  EmailAccountRole,
  IEmailAccount,
} from "../models/mongo/EmailAccount";
import { decryptCredential } from "../utils/credentialsCrypto";
import { env } from "../config/env";

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  fromName?: string;
}

export interface SendMailResult {
  messageId?: string;
  accepted: string[];
  rejected: string[];
  response?: string;
  from: string;
  to: string;
  host: string;
  port: number;
  secure: boolean;
  source: "email_account" | "env";
  accountId?: string;
  friendlyName?: string;
}

export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  source: "email_account" | "env";
  accountId?: string;
  friendlyName?: string;
}

function envSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

function resolveEnvFromAddress(): string {
  return (
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    `GRAC CRM <noreply@${env.clientUrl.replace(/^https?:\/\//, "").split("/")[0]}>`
  );
}

function formatFrom(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  if (!name) return fromEmail;
  // Quote display name if it contains special characters
  if (/[,<>"]/.test(name)) {
    return `"${name.replace(/"/g, '\\"')}" <${fromEmail}>`;
  }
  return `${name} <${fromEmail}>`;
}

/** Port 465 is implicit TLS; treat it as secure even if the flag was left off. */
function resolveSecure(port: number, secure: boolean): boolean {
  if (port === 465) return true;
  return secure;
}

function configFromAccount(account: IEmailAccount): ResolvedSmtpConfig {
  return {
    host: account.host,
    port: account.port,
    secure: resolveSecure(account.port, account.secure),
    username: account.username,
    password: decryptCredential(account.passwordEncrypted),
    from: formatFrom(account.fromName, account.fromEmail),
    source: "email_account",
    accountId: String(account._id),
    friendlyName: account.friendlyName,
  };
}

function configFromEnv(): ResolvedSmtpConfig {
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  return {
    host: process.env.SMTP_HOST as string,
    port,
    secure: resolveSecure(port, process.env.SMTP_SECURE === "true"),
    username: process.env.SMTP_USER as string,
    password: process.env.SMTP_PASS as string,
    from: resolveEnvFromAddress(),
    source: "env",
  };
}

/**
 * Resolve SMTP for a notification role: active EmailAccount with that role,
 * otherwise env SMTP fallback.
 */
export async function getSmtpConfigForRole(
  role: EmailAccountRole
): Promise<ResolvedSmtpConfig | null> {
  const account = await EmailAccount.findOne({
    isActive: true,
    roles: role,
  }).sort({ friendlyName: 1 });

  if (account) {
    return configFromAccount(account);
  }

  if (envSmtpConfigured()) {
    return configFromEnv();
  }

  return null;
}

/** True when a role account or env SMTP can send mail. */
export async function isRoleMailConfigured(
  role: EmailAccountRole
): Promise<boolean> {
  const config = await getSmtpConfigForRole(role);
  return config !== null;
}

async function sendWithConfig(
  config: ResolvedSmtpConfig,
  options: SendMailOptions
): Promise<SendMailResult> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });

  const info = await transporter.sendMail({
    from: config.from,
    to: options.to,
    replyTo: options.replyTo,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });

  return {
    messageId: info.messageId,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
    response: info.response,
    from: config.from,
    to: options.to,
    host: config.host,
    port: config.port,
    secure: config.secure,
    source: config.source,
    accountId: config.accountId,
    friendlyName: config.friendlyName,
  };
}

/**
 * Send email using the EmailAccount assigned to `role`, falling back to env SMTP.
 * Throws if neither is configured or the provider rejects the message.
 */
export async function sendRoleEmail(
  role: EmailAccountRole,
  options: SendMailOptions
): Promise<SendMailResult> {
  const config = await getSmtpConfigForRole(role);
  if (!config) {
    throw new Error(
      `No email account assigned to role "${role}" and env SMTP is not configured.`
    );
  }

  return sendWithConfig(config, options);
}

/**
 * Send using a specific EmailAccount document (Control Panel test send).
 */
export async function sendWithEmailAccount(
  account: IEmailAccount,
  options: SendMailOptions
): Promise<SendMailResult> {
  const config = configFromAccount(account);
  const nickname = options.fromName?.trim();
  if (nickname) {
    config.from = formatFrom(nickname, account.fromEmail);
  }
  return sendWithConfig(config, options);
}

/**
 * Legacy helper: prefer general_notifications account, else env SMTP.
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  return sendRoleEmail("general_notifications", options);
}

export function buildPasswordResetUrl(token: string): string {
  const base = env.clientUrl.replace(/\/$/, "");
  return `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

export function buildLoginUrl(): string {
  const base = env.clientUrl.replace(/\/$/, "");
  return `${base}/auth/login`;
}
