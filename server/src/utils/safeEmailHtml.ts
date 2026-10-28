import sanitizeHtml from "sanitize-html";

const QUOTE_TAGS = sanitizeHtml.defaults.allowedTags
  .filter((tag) => tag !== "style")
  .concat([
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "center",
    "span",
    "font",
    "hr",
    "sub",
    "sup",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "main",
  ]);

const LAYOUT_ATTRS = [
  "style",
  "align",
  "valign",
  "color",
  "bgcolor",
  "dir",
  "width",
  "height",
  "border",
  "cellpadding",
  "cellspacing",
];

const DROPPED_WITH_CONTENT = ["script", "style", "head", "title", "noscript", "textarea", "option"];

const HIDDEN_STYLE =
  /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|max-height\s*:\s*0(px)?\s*(;|$)|font-size\s*:\s*0(px)?\s*(;|$)|opacity\s*:\s*0(\.0+)?\s*(;|$))/i;

function isHiddenElement(frame: sanitizeHtml.IFrame): boolean {
  if (frame.attribs.hidden !== undefined) return true;
  const style = frame.attribs.style;
  return typeof style === "string" && HIDDEN_STYLE.test(style);
}

/**
 * Cleans a received email so it can be quoted inside ours: keeps only body content and
 * drops anything (style blocks, classes, hidden elements) that could hide our message.
 */
export function quotableHtml(html: string): string {
  if (!html.trim()) return "";
  return sanitizeHtml(html, {
    allowedTags: QUOTE_TAGS,
    allowedAttributes: {
      "*": LAYOUT_ATTRS,
      a: ["href", "target", "rel", ...LAYOUT_ATTRS],
      img: ["src", "alt", ...LAYOUT_ATTRS],
      td: ["colspan", "rowspan", ...LAYOUT_ATTRS],
      th: ["colspan", "rowspan", ...LAYOUT_ATTRS],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    nonTextTags: DROPPED_WITH_CONTENT,
    exclusiveFilter: isHiddenElement,
    parseStyleAttributes: false,
  }).trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Readable plain text for the text/plain part: no CSS, links kept as `text (url)`. */
export function emailPlainText(html: string): string {
  if (!html.trim()) return "";
  const stripped = sanitizeHtml(html, {
    allowedTags: ["a", "br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"],
    allowedAttributes: { a: ["href"] },
    nonTextTags: DROPPED_WITH_CONTENT,
    exclusiveFilter: isHiddenElement,
  });
  const text = stripped
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const url = decodeEntities(href).trim();
      const inner = label.replace(/<[^>]+>/g, "").trim();
      if (!url || /^(tel|mailto):/i.test(url) || decodeEntities(inner) === url) return inner;
      return inner ? `${inner} (${url})` : url;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function quotePlainText(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

export function wrapEmailDocument(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:16px;background-color:#ffffff;">
${html}
</body>
</html>`;
}

function comparable(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when the visible text of `html` still contains the text of our message body. */
export function bodyIsVisible(html: string, bodyHtml: string): boolean {
  const body = comparable(emailPlainText(bodyHtml));
  if (!body) return true;
  const visible = comparable(emailPlainText(html));
  return visible.includes(body.slice(0, 200));
}

/**
 * Builds the preferred layout and checks that our message is still visible in it.
 * When it isn't, rebuilds with the simple layout and reports the fallback.
 */
export function ensureVisibleBody(
  bodyHtml: string,
  build: (simple: boolean) => string,
  preferSimple = false,
): { html: string; simple: boolean; fallback: boolean } {
  const html = build(preferSimple);
  if (preferSimple || bodyIsVisible(html, bodyHtml)) {
    return { html, simple: preferSimple, fallback: false };
  }
  return { html: build(true), simple: true, fallback: true };
}
