import { COMPANY } from "@/lib/constants";
import type { MailboxAddress, MailboxReplyMode } from "@/lib/api";
import { formatAddressList } from "@/lib/mailboxReply";

export const CANNED_REPLY_TEMPLATES: {
  id: string;
  title: string;
  body: string;
}[] = [
  {
    id: "thank-you",
    title: "Thank You for Reaching Out",
    body: "<p>Hello,</p><p>Thank you for contacting Generator Maintenance of Florida. We have received your message and our team is reviewing your request. One of our specialists will follow up with you shortly.</p><p>If you require immediate emergency assistance, please feel free to call our office directly at <strong>(386) 631-8982</strong>.</p><p>Best regards,<br>The GMF Team</p>",
  },
  {
    id: "dispatch",
    title: "Technician Dispatched",
    body: "<p>Hello,</p><p>This is to confirm that a factory-certified Generac technician has been scheduled to inspect and service your generator system. We will contact you upon our technician's arrival.</p><p>Please ensure that access to the generator and electrical service panel is clear.</p><p>Best regards,<br>Service Dispatch Team</p>",
  },
  {
    id: "maintenance-followup",
    title: "Maintenance Follow-up",
    body: "<p>Hello,</p><p>We recently completed maintenance on your standby generator system. All routine checks, oil/filter inspections, and transfer switch operational tests were performed to ensure your system is storm-ready.</p><p>Please let us know if you have any questions about your service report.</p><p>Thank you for choosing Generator Maintenance of Florida!</p>",
  },
  {
    id: "estimate-ready",
    title: "Estimate Ready for Review",
    body: "<p>Hello,</p><p>Your requested estimate is prepared and ready for your review. We've outlined all equipment, permits, and professional installation details tailored for your property.</p><p>Please review and let us know if you'd like to proceed or if you have any questions.</p><p>Best regards,<br>Sales & Estimates</p>",
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatQuoteDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Wraps body HTML in the Generator Maintenance of Florida branded letterhead and signature shell.
 * Uses inline-styled HTML tables compatible with Gmail, Apple Mail, Outlook Web, and Outlook Desktop.
 */
export function renderBrandedReplyShell(bodyHtml: string): string {
  const content = bodyHtml.trim() || "<p></p>";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
  <!-- Brand Header -->
  <tr>
    <td style="background-color:#0b1f33;padding:20px 28px;border-bottom:3px solid #f36c21;text-align:left;">
      <div style="font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;">
        ${escapeHtml(COMPANY.name)}
      </div>
      <div style="margin-top:3px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:11px;color:#f36c21;font-weight:600;">
        ${escapeHtml(COMPANY.tagline)}
      </div>
    </td>
  </tr>

  <!-- Message Body -->
  <tr>
    <td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:14px;line-height:1.6;color:#231f20;">
      ${content}
    </td>
  </tr>

  <!-- Brand Signature Footer -->
  <tr>
    <td style="padding:16px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:12px;color:#64748b;line-height:1.5;">
      <div style="font-weight:700;color:#0b1f33;font-size:12px;">${escapeHtml(COMPANY.name)}</div>
      <div style="margin-top:4px;">
        <a href="${COMPANY.phoneHref}" style="color:#f36c21;text-decoration:none;font-weight:600;">${escapeHtml(COMPANY.phone)}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#f36c21;text-decoration:none;">${escapeHtml(COMPANY.email)}</a>
      </div>
      <div style="margin-top:3px;font-size:11px;color:#94a3b8;">
        ${escapeHtml(COMPANY.license)} &nbsp;·&nbsp; Generac Authorized Dealer &nbsp;·&nbsp; Central Florida
      </div>
    </td>
  </tr>
</table>`;
}

/**
 * Builds the full HTML document for live preview in the composer iframe,
 * including the message body (branded or plain) plus the formatted quoted thread.
 */
export function renderFullReplyPreview(input: {
  bodyHtml: string;
  mode: MailboxReplyMode;
  useBrandTemplate: boolean;
  original: {
    html?: string | null;
    text?: string | null;
    from: MailboxAddress[];
    to: MailboxAddress[];
    date: string | null;
    subject: string;
  };
}): string {
  const content = input.useBrandTemplate
    ? renderBrandedReplyShell(input.bodyHtml)
    : `<div style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#231f20;">${input.bodyHtml}</div>`;

  const quotedBody = input.original.html?.trim()
    ? input.original.html
    : `<pre style="white-space:pre-wrap;font-family:sans-serif;margin:0;">${escapeHtml(input.original.text || "(no message body)")}</pre>`;

  let quotedHeader = "";
  if (input.mode === "forward") {
    quotedHeader = [
      "---------- Forwarded message ---------",
      `From: ${formatAddressList(input.original.from)}`,
      `Date: ${formatQuoteDate(input.original.date) || "Unknown"}`,
      `Subject: ${input.original.subject || "(no subject)"}`,
      `To: ${formatAddressList(input.original.to)}`,
    ]
      .map(escapeHtml)
      .join("<br>");
  } else {
    const when = formatQuoteDate(input.original.date);
    const who = formatAddressList(input.original.from);
    quotedHeader = escapeHtml(when ? `On ${when}, ${who} wrote:` : `${who} wrote:`);
  }

  const quotedBlock = `<div style="max-width:640px;margin:20px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;">
    <p style="margin:0 0 8px 0;font-weight:500;">${quotedHeader}</p>
    <blockquote style="margin:0;padding-left:12px;border-left:2px solid #cbd5e1;color:#475569;">
      ${quotedBody}
    </blockquote>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      padding: 20px 16px;
      background-color: #f1f5f9;
      font-family: Arial, Helvetica, sans-serif, -apple-system;
      -webkit-font-smoothing: antialiased;
    }
  </style>
</head>
<body>
  ${content}
  ${quotedBlock}
</body>
</html>`;
}
