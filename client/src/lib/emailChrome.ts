import { COMPANY } from "@/lib/constants";

export type EmailChrome = {
  headerHtml: string;
  footerHtml: string;
};

export type LegacyEmailChrome = {
  header?: {
    companyName?: string;
    tagline?: string;
    backgroundColor?: string;
    titleColor?: string;
    taglineColor?: string;
  };
  footer?: {
    companyName?: string;
    phone?: string;
    email?: string;
    backgroundColor?: string;
    textColor?: string;
    linkColor?: string;
  };
};

export const EMAIL_CHROME_HTML_MAX = 10_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const DEFAULT_HEADER_HTML = `<div style="background-color:#0b1f33;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
  <div style="font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">${escapeHtml(COMPANY.name)}</div>
  <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:12px;color:#f36c21;">${escapeHtml(COMPANY.tagline)}</div>
</div>`;

export const DEFAULT_FOOTER_HTML = `<div style="background-color:#231f20;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
  <div style="font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:13px;font-weight:700;color:#ffffff;">${escapeHtml(COMPANY.name)}</div>
  <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:12px;line-height:1.5;color:#ffffff;opacity:0.78;">
    ${escapeHtml(COMPANY.phone)}
    &nbsp;·&nbsp;
    <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#f36c21;text-decoration:none;">${escapeHtml(COMPANY.email)}</a>
  </div>
</div>`;

export const DEFAULT_EMAIL_CHROME: EmailChrome = {
  headerHtml: DEFAULT_HEADER_HTML,
  footerHtml: DEFAULT_FOOTER_HTML,
};

function headerFieldsToHtml(
  header: NonNullable<LegacyEmailChrome["header"]>,
): string {
  const companyName = header.companyName?.trim() || COMPANY.name;
  const tagline = header.tagline?.trim() || COMPANY.tagline;
  const backgroundColor = header.backgroundColor?.trim() || "#0b1f33";
  const titleColor = header.titleColor?.trim() || "#ffffff";
  const taglineColor = header.taglineColor?.trim() || "#f36c21";
  return `<div style="background-color:${escapeHtml(backgroundColor)};border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
  <div style="font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${escapeHtml(titleColor)};">${escapeHtml(companyName)}</div>
  <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:12px;color:${escapeHtml(taglineColor)};">${escapeHtml(tagline)}</div>
</div>`;
}

function footerFieldsToHtml(
  footer: NonNullable<LegacyEmailChrome["footer"]>,
): string {
  const companyName = footer.companyName?.trim() || COMPANY.name;
  const phone = footer.phone?.trim() || COMPANY.phone;
  const email = footer.email?.trim() || COMPANY.email;
  const backgroundColor = footer.backgroundColor?.trim() || "#231f20";
  const textColor = footer.textColor?.trim() || "#ffffff";
  const linkColor = footer.linkColor?.trim() || "#f36c21";
  return `<div style="background-color:${escapeHtml(backgroundColor)};border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
  <div style="font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:13px;font-weight:700;color:${escapeHtml(textColor)};">${escapeHtml(companyName)}</div>
  <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:12px;line-height:1.5;color:${escapeHtml(textColor)};opacity:0.78;">
    ${escapeHtml(phone)}
    &nbsp;·&nbsp;
    <a href="mailto:${escapeHtml(email)}" style="color:${escapeHtml(linkColor)};text-decoration:none;">${escapeHtml(email)}</a>
  </div>
</div>`;
}

function isLegacyChrome(input: unknown): input is LegacyEmailChrome {
  if (!input || typeof input !== "object") return false;
  const row = input as Record<string, unknown>;
  if (typeof row.headerHtml === "string" || typeof row.footerHtml === "string") {
    return false;
  }
  return (
    (row.header != null && typeof row.header === "object") ||
    (row.footer != null && typeof row.footer === "object")
  );
}

export function mergeEmailChrome(
  input?: Partial<EmailChrome> | LegacyEmailChrome | null,
): EmailChrome {
  if (!input) return { ...DEFAULT_EMAIL_CHROME };

  if (isLegacyChrome(input)) {
    return {
      headerHtml: input.header
        ? headerFieldsToHtml(input.header)
        : DEFAULT_HEADER_HTML,
      footerHtml: input.footer
        ? footerFieldsToHtml(input.footer)
        : DEFAULT_FOOTER_HTML,
    };
  }

  const headerHtml =
    typeof input.headerHtml === "string" && input.headerHtml.trim()
      ? input.headerHtml
      : DEFAULT_HEADER_HTML;
  const footerHtml =
    typeof input.footerHtml === "string" && input.footerHtml.trim()
      ? input.footerHtml
      : DEFAULT_FOOTER_HTML;
  return { headerHtml, footerHtml };
}

export function isEmailBodyEmpty(html: string): boolean {
  return (
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim().length === 0
  );
}
