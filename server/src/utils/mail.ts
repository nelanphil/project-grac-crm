import { env } from "../config/env";

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Minimal mail helper. When SMTP is not configured, logs the message
 * (including reset URLs) so local/dev flows remain testable.
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from =
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    `GRAC CRM <noreply@${env.clientUrl.replace(/^https?:\/\//, "").split("/")[0]}>`;

  if (!host || !user || !pass) {
    console.log("[mail] SMTP not configured — logging message instead:");
    console.log(`  To: ${options.to}`);
    console.log(`  Subject: ${options.subject}`);
    console.log(`  Body:\n${options.text}`);
    return;
  }

  // Lazy-require so the server boots without nodemailer installed.
  // If nodemailer is unavailable, fall back to logging.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer") as {
      createTransport: (opts: unknown) => {
        sendMail: (msg: unknown) => Promise<unknown>;
      };
    };
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  } catch (err) {
    console.error("[mail] Failed to send via SMTP, logging instead:", err);
    console.log(`  To: ${options.to}`);
    console.log(`  Subject: ${options.subject}`);
    console.log(`  Body:\n${options.text}`);
  }
}

export function buildPasswordResetUrl(token: string): string {
  const base = env.clientUrl.replace(/\/$/, "");
  return `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
}
