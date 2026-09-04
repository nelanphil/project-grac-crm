/**
 * Branded HTML email layouts for transactional mail.
 * Colors match the marketing site (client/src/app/globals.css).
 */

import {
  EmailChrome,
  htmlToPlainText,
  looksLikeHtml,
  mergeEmailChrome,
  sanitizeEmailBodyHtml,
  sanitizeEmailChromeHtml,
} from "./emailChrome";

const BRAND = {
  dark: "#231f20",
  orange: "#f36c21",
  midnight: "#0b1f33",
  neutral100: "#f5f5f5",
  neutral200: "#e5e5e5",
  neutral600: "#666666",
  white: "#ffffff",
} as const;

const COMPANY = {
  name: "Generator Maintenance of Florida",
  shortName: "GMF",
  tagline: "Expert Backup Power for Central & South Florida",
  phone: "(386) 631-8982",
  email: "info@generatormaintenancefl.com",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BrandedEmailContent {
  /** Visible heading inside the card */
  heading: string;
  /** Optional preheader (inbox preview) */
  previewText?: string;
  /** Inner HTML body (already safe / trusted server content) */
  bodyHtml: string;
  /** Primary CTA button */
  cta?: { label: string; url: string };
  /** Small print under the CTA */
  footnoteHtml?: string;
  /** Hide the default “do not reply” footer line (e.g. contact-form mail). */
  hideNoReplyNote?: boolean;
  /** Per-template header/footer chrome. Falls back to the general GMF brand. */
  chrome?: EmailChrome;
}

/**
 * Wrap content in a Generator Maintenance of Florida branded shell
 * (header + card + footer). Uses table layout for email clients.
 */
export function renderBrandedEmail(content: BrandedEmailContent): string {
  const chrome = content.chrome ? mergeEmailChrome(content.chrome) : null;
  const headerHtml = chrome
    ? sanitizeEmailChromeHtml(chrome.headerHtml)
    : "";
  const footerHtml = chrome
    ? sanitizeEmailChromeHtml(chrome.footerHtml)
    : "";
  const preview = content.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(content.previewText)}</div>`
    : "";

  const ctaBlock = content.cta
    ? `
      <tr>
        <td align="center" style="padding:8px 0 24px;">
          <a href="${escapeHtml(content.cta.url)}"
             style="display:inline-block;background-color:${BRAND.orange};color:${BRAND.white};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;">
            ${escapeHtml(content.cta.label)}
          </a>
        </td>
      </tr>`
    : "";

  const footnote = content.footnoteHtml
    ? `
      <tr>
        <td style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${BRAND.neutral600};">
          ${content.footnoteHtml}
        </td>
      </tr>`
    : "";

  const noReplyNote = content.hideNoReplyNote
    ? ""
    : `
              <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#888888;">
                This is an automated message from GRAC CRM. Please do not reply directly to this email.
              </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(content.heading)}</title>
  <style>
    body, td, p, div, span, a, li, h1, h2, h3 {
      font-family: Arial, Helvetica, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji";
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.neutral100};">
  ${preview}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.neutral100};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <!-- Header -->
          ${
            chrome
              ? `<tr><td style="padding:0;">${headerHtml}</td></tr>`
              : `<tr>
            <td style="background-color:${BRAND.midnight};border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${BRAND.white};">
                ${escapeHtml(COMPANY.name)}
              </div>
              <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.orange};">
                ${escapeHtml(COMPANY.tagline)}
              </div>
            </td>
          </tr>`
          }
          <!-- Body card -->
          <tr>
            <td style="background-color:${BRAND.white};padding:32px;border-left:1px solid ${BRAND.neutral200};border-right:1px solid ${BRAND.neutral200};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 16px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:22px;font-weight:700;color:${BRAND.dark};">
                    ${escapeHtml(content.heading)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:15px;line-height:1.6;color:${BRAND.dark};">
                    ${content.bodyHtml}
                  </td>
                </tr>
                ${ctaBlock}
                ${footnote}
              </table>
            </td>
          </tr>
          <!-- Footer -->
          ${
            chrome
              ? `<tr><td style="padding:0;">${footerHtml}${noReplyNote}</td></tr>`
              : `<tr>
            <td style="background-color:${BRAND.dark};border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:${BRAND.white};">
                ${escapeHtml(COMPANY.name)}
              </div>
              <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#b0b0b0;">
                ${escapeHtml(COMPANY.phone)}
                &nbsp;·&nbsp;
                <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:${BRAND.orange};text-decoration:none;">${escapeHtml(COMPANY.email)}</a>
              </div>
              ${noReplyNote}
            </td>
          </tr>`
          }
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPasswordResetEmail(resetUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "Reset your GRAC CRM password";
  const text = `Reset your password using this link (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.\n\n— ${COMPANY.name}`;

  const html = renderBrandedEmail({
    heading: "Reset your password",
    previewText: "Reset your GRAC CRM password. This link expires in 1 hour.",
    bodyHtml: `
      <p style="margin:0 0 12px;">We received a request to reset the password for your GRAC CRM account.</p>
      <p style="margin:0;">Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
    `,
    cta: { label: "Reset password", url: resetUrl },
    footnoteHtml: `
      <p style="margin:0 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="margin:0;word-break:break-all;"><a href="${escapeHtml(resetUrl)}" style="color:${BRAND.orange};">${escapeHtml(resetUrl)}</a></p>
      <p style="margin:16px 0 0;">If you did not request a password reset, you can safely ignore this email.</p>
    `,
  });

  return { subject, text, html };
}

export function buildSignupWelcomeEmail(opts: {
  firstName: string;
  loginUrl: string;
}): { subject: string; text: string; html: string } {
  const name = opts.firstName.trim() || "there";
  const subject = "Welcome to GRAC CRM";
  const text = `Hi ${name},\n\nYour GRAC CRM account has been created. Sign in here:\n\n${opts.loginUrl}\n\nIf you did not create this account, you can ignore this email.\n\n— ${COMPANY.name}`;

  const html = renderBrandedEmail({
    heading: "Welcome to GRAC CRM",
    previewText: `Hi ${name}, your GRAC CRM account is ready.`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0;">Your GRAC CRM account with ${escapeHtml(COMPANY.name)} has been created. You can sign in anytime using the button below.</p>
    `,
    cta: { label: "Sign in to your account", url: opts.loginUrl },
    footnoteHtml: `
      <p style="margin:0;">If you did not create this account, you can safely ignore this email.</p>
    `,
  });

  return { subject, text, html };
}

export function buildContactFormEmail(opts: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
}): { subject: string; text: string; html: string } {
  const name = `${opts.firstName} ${opts.lastName}`.trim();
  const subject = `Website contact from ${name}`;

  const text = [
    `New contact form submission from ${name}.`,
    "",
    `Name: ${name}`,
    `Email: ${opts.email}`,
    `Phone: ${opts.phone.trim() || "(not provided)"}`,
    "",
    "Message:",
    opts.message,
    "",
    "Reply to this email to respond to the sender.",
    "",
    `— ${COMPANY.name}`,
  ].join("\n");

  const html = renderBrandedEmail({
    heading: "New contact form message",
    previewText: `${name} sent a message from the website contact form.`,
    hideNoReplyNote: true,
    bodyHtml: `
      <p style="margin:0 0 16px;">Someone submitted the website contact form.</p>
      <p style="margin:0 0 4px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p style="margin:0 0 4px;"><strong>Email:</strong> <a href="mailto:${escapeHtml(opts.email)}" style="color:${BRAND.orange};">${escapeHtml(opts.email)}</a></p>
      <p style="margin:0 0 16px;"><strong>Phone:</strong> ${escapeHtml(opts.phone.trim() || "(not provided)")}</p>
      <p style="margin:0 0 8px;"><strong>Message:</strong></p>
      <p style="margin:0;white-space:pre-wrap;">${escapeHtml(opts.message)}</p>
    `,
    footnoteHtml: `
      <p style="margin:16px 0 0;">Reply to this email to respond to the sender.</p>
    `,
  });

  return { subject, text, html };
}

function stripPaymentLinkFromText(text: string, paymentUrl: string): string {
  return text
    .split(paymentUrl)
    .join("")
    .replace(/\{\{\s*payment_link\s*\}\}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Wrap staff-composed plain text or HTML in the branded GMF email shell. */
export function buildStaffOutboundEmail(opts: {
  subject: string;
  bodyText: string;
  paymentUrl?: string;
  chrome?: EmailChrome;
}): { subject: string; text: string; html: string } {
  const paymentUrl = opts.paymentUrl?.trim();
  const chrome = mergeEmailChrome(opts.chrome);
  const subjectRaw = paymentUrl
    ? stripPaymentLinkFromText(opts.subject, paymentUrl)
    : opts.subject;
  const subject = subjectRaw.trim() || "Message";
  const bodyForHtml = paymentUrl
    ? stripPaymentLinkFromText(opts.bodyText, paymentUrl)
    : opts.bodyText;
  const isHtml = looksLikeHtml(bodyForHtml);
  const bodyHtml = isHtml
    ? sanitizeEmailBodyHtml(bodyForHtml)
    : escapeHtml(bodyForHtml)
        .split(/\n{2,}/)
        .map(
          (block) =>
            `<p style="margin:0 0 12px;">${block.replace(/\n/g, "<br />")}</p>`,
        )
        .join("");
  const plainBody = isHtml ? htmlToPlainText(bodyForHtml) : bodyForHtml;
  const previewText = plainBody.replace(/\s+/g, " ").trim().slice(0, 140);

  const html = renderBrandedEmail({
    heading: subject,
    previewText,
    bodyHtml: bodyHtml || `<p style="margin:0;"></p>`,
    hideNoReplyNote: true,
    cta: paymentUrl
      ? { label: "Pay securely", url: paymentUrl }
      : undefined,
    chrome,
  });

  const text = paymentUrl
    ? [plainBody, "", `Pay securely: ${paymentUrl}`].filter(Boolean).join("\n")
    : isHtml
      ? htmlToPlainText(opts.bodyText)
      : opts.bodyText;

  return { subject, text, html };
}
