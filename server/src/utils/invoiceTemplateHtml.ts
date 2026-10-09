import sanitizeHtml from "sanitize-html";

const ALIGN = /^(left|center|right|justify)$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR =
  /^rgb\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\)$/;

export const INVOICE_TEXT_HTML_MAX = 10_000;

export function sanitizeInvoiceTextHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
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
      "h2",
      "h3",
      "span",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["style"],
      p: ["style"],
      h2: ["style"],
      h3: ["style"],
      li: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [HEX_COLOR, RGB_COLOR],
        "text-align": [ALIGN],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  }).slice(0, INVOICE_TEXT_HTML_MAX);
}
