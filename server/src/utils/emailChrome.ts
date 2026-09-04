import sanitizeHtml from "sanitize-html";

export type EmailChrome = {
  headerHtml: string;
  footerHtml: string;
};

/** Stored on templates created before free-HTML chrome. */
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

const COMPANY = {
  name: "Generator Maintenance of Florida",
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

function headerFieldsToHtml(header: NonNullable<LegacyEmailChrome["header"]>): string {
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

function footerFieldsToHtml(footer: NonNullable<LegacyEmailChrome["footer"]>): string {
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

function imgAttr(tag: string, name: string): string {
  const match = new RegExp(
    `(?:\\s|^)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function isChatSymbol(value: string): boolean {
  return (
    /\p{Extended_Pictographic}/u.test(value) ||
    /\p{Emoji_Presentation}/u.test(value) ||
    /[\u2600-\u27BF]/.test(value)
  );
}

function emojiFromCodepointSrc(src: string): string {
  const file = /\/(?:svg|72x72|72|emoji)?\/?([0-9a-fA-F]{4,8}(?:-[0-9a-fA-F]{4,8})*)\.(?:png|svg|webp)(?:\?|$)/i.exec(
    src,
  );
  if (!file) return "";
  try {
    return file[1]
      .split("-")
      .map((part) => String.fromCodePoint(Number.parseInt(part, 16)))
      .join("");
  } catch {
    return "";
  }
}

/**
 * Visual editors and chat apps often store emoji as <img>. Turn those
 * back into characters so preview/send don't drop them.
 */
export function preserveChatSymbols(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const labeled =
      imgAttr(tag, "alt") ||
      imgAttr(tag, "aria-label") ||
      imgAttr(tag, "title");
    if (labeled && isChatSymbol(labeled)) return labeled;
    const fromSrc = emojiFromCodepointSrc(imgAttr(tag, "src"));
    if (fromSrc && isChatSymbol(fromSrc)) return fromSrc;
    return tag;
  });
}

function holdChatSymbols(html: string, transform: (html: string) => string): string {
  const held: string[] = [];
  const masked = html.replace(
    /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu,
    (symbol) => {
      held.push(symbol);
      return `[[EMJ${held.length - 1}]]`;
    },
  );
  return transform(masked).replace(/\[\[EMJ(\d+)\]\]/g, (_match, index) => {
    return held[Number(index)] ?? "";
  });
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value.trim());
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BODY_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "ul",
  "ol",
  "li",
  "a",
  "span",
  "h1",
  "h2",
  "h3",
];

const COLOR = [
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
  /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|0?\.\d+|1)\s*\)$/,
];
const SAFE_STYLE = [/^[\w\s#%,.\-()'",]+$/i];

const BODY_STYLE = {
  color: COLOR,
  "text-align": [/^(left|right|center|justify)$/],
};

export function sanitizeEmailBodyHtml(html: string): string {
  return holdChatSymbols(preserveChatSymbols(html), (next) =>
    sanitizeHtml(next, {
      allowedTags: [...BODY_TAGS, "img"],
      allowedAttributes: {
        a: ["href", "target", "rel"],
        img: ["src", "alt", "width", "height", "style", "title"],
        span: ["style"],
        p: ["style"],
        h1: ["style"],
        h2: ["style"],
        h3: ["style"],
        li: ["style"],
      },
      allowedStyles: { "*": BODY_STYLE },
      allowedSchemes: ["http", "https", "mailto", "data"],
      allowedSchemesByTag: { img: ["http", "https", "data"] },
      transformTags: {
        a: sanitizeHtml.simpleTransform("a", {
          target: "_blank",
          rel: "noopener noreferrer",
        }),
      },
    }),
  );
}

const CHROME_STYLE = {
  color: COLOR,
  background: SAFE_STYLE,
  "background-color": COLOR,
  padding: SAFE_STYLE,
  "padding-top": SAFE_STYLE,
  "padding-right": SAFE_STYLE,
  "padding-bottom": SAFE_STYLE,
  "padding-left": SAFE_STYLE,
  margin: SAFE_STYLE,
  "margin-top": SAFE_STYLE,
  "margin-right": SAFE_STYLE,
  "margin-bottom": SAFE_STYLE,
  "margin-left": SAFE_STYLE,
  "font-size": SAFE_STYLE,
  "font-weight": SAFE_STYLE,
  "font-family": SAFE_STYLE,
  "font-style": SAFE_STYLE,
  "letter-spacing": SAFE_STYLE,
  "text-align": [/^(left|right|center|justify)$/],
  "line-height": SAFE_STYLE,
  width: SAFE_STYLE,
  "max-width": SAFE_STYLE,
  height: SAFE_STYLE,
  border: SAFE_STYLE,
  "border-radius": SAFE_STYLE,
  "border-top": SAFE_STYLE,
  "border-right": SAFE_STYLE,
  "border-bottom": SAFE_STYLE,
  "border-left": SAFE_STYLE,
  opacity: SAFE_STYLE,
  display: [/^(block|inline|inline-block|none)$/],
  "text-decoration": SAFE_STYLE,
};

export function sanitizeEmailChromeHtml(html: string): string {
  return holdChatSymbols(preserveChatSymbols(html), (next) =>
    sanitizeHtml(next, {
    allowedTags: [
      ...BODY_TAGS,
      "div",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "img",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height", "style", "title"],
      table: ["style", "width", "cellpadding", "cellspacing", "border", "align", "bgcolor", "role"],
      td: ["style", "width", "align", "valign", "colspan", "rowspan", "bgcolor"],
      th: ["style", "width", "align", "valign", "colspan", "rowspan", "bgcolor"],
      tr: ["style", "align", "bgcolor"],
      div: ["style", "align"],
      span: ["style"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      li: ["style"],
    },
    allowedStyles: { "*": CHROME_STYLE },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
    }),
  );
}

export function sanitizeEmailBody(body: string): string {
  if (!looksLikeHtml(body)) return body;
  return sanitizeEmailBodyHtml(body);
}

export function sanitizeEmailChrome(chrome: EmailChrome): EmailChrome {
  return {
    headerHtml: sanitizeEmailChromeHtml(chrome.headerHtml),
    footerHtml: sanitizeEmailChromeHtml(chrome.footerHtml),
  };
}

export function renderEmailChrome(
  chrome: EmailChrome,
  render: (value: string) => string,
): EmailChrome {
  return {
    headerHtml: render(chrome.headerHtml),
    footerHtml: render(chrome.footerHtml),
  };
}
