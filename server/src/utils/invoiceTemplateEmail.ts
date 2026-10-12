import {
  type InvoiceBlock,
  type InvoiceLeafBlock,
} from "../schemas/invoiceTemplate.schema";
import { DEFAULT_UNSUBSCRIBE_NOTE, htmlToPlainText } from "./emailChrome";
import { sanitizeInvoiceTextHtml } from "./invoiceTemplateHtml";

const COMPANY = {
  name: "Generator Maintenance of Florida",
  phone: "(386) 631-8982",
  phoneHref: "tel:+13866318982",
  email: "contact@genmaintoffl.com",
  license: "Licensed & Insured",
} as const;

const FONT_STACK: Record<string, string> = {
  inter: "Arial, Helvetica, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
  arial: "Arial, Helvetica, sans-serif",
  courier: "'Courier New', Courier, monospace",
};

const COLUMN_SPLIT: Record<number, [number, number]> = {
  33: [33, 67],
  40: [40, 60],
  50: [50, 50],
  60: [60, 40],
  67: [67, 33],
};

type TextStyle = {
  font: string;
  size: number;
  weight: number;
  color: string;
};

export type InvoiceTemplateEmailParty = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
};

export type InvoiceTemplateEmailAddress = {
  label?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

export type InvoiceTemplateEmailDocument = {
  number: string;
  customerId: number;
  sourceType: string;
  status: string;
  issuedAt: Date | string | null;
  dueDate: Date | string | null;
  paidAt: Date | string | null;
  paymentProvider: string | null;
  lineItems: { description: string; amountCents: number }[];
  amountCents: number;
  originalAmountCents?: number | null;
  discountCode?: string | null;
  discountCents?: number;
  taxRatePercent?: number;
  taxCents?: number;
  customer: InvoiceTemplateEmailParty | null;
  serviceAddress: InvoiceTemplateEmailAddress | null;
  workOrderNotes: { content: string }[];
};

type Piece = { html: string; text: string };

const EMPTY: Piece = { html: "", text: "" };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number.isFinite(cents) ? cents : 0) / 100);
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US");
}

function cssFont(style: TextStyle): string {
  const family = FONT_STACK[style.font] ?? FONT_STACK.arial;
  const color = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(style.color)
    ? style.color
    : "#231f20";
  return `font-family:${family};font-size:${style.size}px;font-weight:${style.weight};color:${color};line-height:1.4;`;
}

function paragraph(text: string, style: string): string {
  return `<p style="margin:0 0 4px;${style}">${text}</p>`;
}

function labelHtml(label: string, style: TextStyle, tracking = "0.08em"): string {
  return `<p style="margin:0 0 8px;${cssFont(style)}text-transform:uppercase;letter-spacing:${tracking};">${escapeHtml(label)}</p>`;
}

function formatAddressLines(parts: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string[] {
  const lines: string[] = [];
  if (parts.address?.trim()) lines.push(parts.address.trim());
  const state = parts.state?.trim().toUpperCase() ?? "";
  const cityStateZip = [
    parts.city?.trim(),
    [state, parts.zip?.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  if (cityStateZip) lines.push(cityStateZip);
  return lines;
}

function addressesEqual(
  customer: InvoiceTemplateEmailParty | null,
  service: InvoiceTemplateEmailAddress | null,
): boolean {
  if (!customer || !service) return false;
  return (
    customer.address.trim().toLowerCase() === service.address.trim().toLowerCase() &&
    customer.city.trim().toLowerCase() === service.city.trim().toLowerCase() &&
    customer.state.trim().toLowerCase() === service.state.trim().toLowerCase() &&
    customer.zip.trim().toLowerCase() === service.zip.trim().toLowerCase()
  );
}

function showServiceAddress(invoice: InvoiceTemplateEmailDocument): boolean {
  const serviceAddress = invoice.serviceAddress;
  return (
    Boolean(serviceAddress?.address?.trim()) &&
    !addressesEqual(invoice.customer, serviceAddress)
  );
}

function imagePercent(block: Extract<InvoiceLeafBlock, { type: "image" }>): number {
  if (typeof block.widthPercent === "number") return block.widthPercent;
  if (block.width === "sm") return 40;
  if (block.width === "full") return 100;
  return 70;
}

function spaced(html: string): string {
  if (!html) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td>${html}</td></tr></table>`;
}

function joinPieces(pieces: Piece[]): Piece {
  return {
    html: pieces.map((piece) => piece.html).join(""),
    text: pieces
      .map((piece) => piece.text.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}

function renderLeaf(
  block: InvoiceLeafBlock,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  switch (block.type) {
    case "text":
      return renderText(block);
    case "image":
      return renderImage(block);
    case "spacer":
      return {
        html: `<div style="height:${block.height}px;line-height:${block.height}px;font-size:${block.height}px;">&nbsp;</div>`,
        text: "",
      };
    case "divider":
      return {
        html: `<hr style="border:0;border-top:1px solid #e5e5e5;margin:0;" />`,
        text: "",
      };
    case "heading":
      return renderHeading(block, invoice);
    case "company":
      return renderCompany(block);
    case "billTo":
      return renderBillTo(block, invoice);
    case "meta":
      return renderMeta(block, invoice);
    case "serviceAddress":
      return renderServiceAddress(block, invoice);
    case "lineItems":
      return renderLineItems(block, invoice);
    case "notes":
      return renderNotes(block, invoice);
    case "totals":
      return renderTotals(block, invoice);
    case "paymentMethod":
      return renderPaymentMethod(block, invoice);
    default:
      return EMPTY;
  }
}

function renderText(block: Extract<InvoiceLeafBlock, { type: "text" }>): Piece {
  const html = sanitizeInvoiceTextHtml(block.html).trim();
  if (!html || html === "<p></p>") return EMPTY;
  const text = htmlToPlainText(html);
  if (block.tone === "muted") {
    return {
      html: `<div style="border-top:1px solid #e5e5e5;padding-top:24px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#737373;">${html}</div>`,
      text,
    };
  }
  return {
    html: `<div style="text-align:${block.align};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#404040;">${html}</div>`,
    text,
  };
}

function renderImage(block: Extract<InvoiceLeafBlock, { type: "image" }>): Piece {
  const url = block.url.trim();
  if (!/^https:\/\/.+/i.test(url)) return EMPTY;
  const percent = imagePercent(block);
  const align = block.align === "center" || block.align === "right" ? block.align : "left";
  const margin =
    align === "center" ? "margin:0 auto;" : align === "right" ? "margin:0 0 0 auto;" : "";
  const height =
    block.maxHeight > 0 ? `max-height:${block.maxHeight}px;` : "";
  const aspect = block.aspect !== "auto" ? `aspect-ratio:${block.aspect};` : "";
  const fit = block.fit === "cover" ? "object-fit:cover;" : "object-fit:contain;";
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${align}"><img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt)}" style="display:block;border:0;width:${percent}%;max-width:${percent}%;height:auto;${height}${aspect}${fit}${margin}" /></td></tr></table>`,
    text: block.alt.trim(),
  };
}

function renderHeading(
  block: Extract<InvoiceLeafBlock, { type: "heading" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const lines = [block.label];
  let html = labelHtml(block.label, block.labelStyle, "0.2em");
  if (block.showNumber) {
    lines.push(invoice.number);
    html += paragraph(escapeHtml(invoice.number), cssFont(block.valueStyle));
  }
  if (block.showSource) {
    const source = invoice.sourceType.replace(/_/g, " ");
    lines.push(source);
    html += paragraph(escapeHtml(source), cssFont(block.labelStyle));
  }
  return { html, text: lines.join("\n") };
}

function renderCompany(
  block: Extract<InvoiceLeafBlock, { type: "company" }>,
): Piece {
  if (!block.showName && !block.showPhone && !block.showEmail && !block.showLicense) {
    return EMPTY;
  }
  const lines: string[] = [];
  const parts: string[] = [];
  if (block.showName) {
    lines.push(COMPANY.name);
    parts.push(paragraph(escapeHtml(COMPANY.name), cssFont(block.valueStyle)));
  }
  if (block.showPhone) {
    lines.push(COMPANY.phone);
    parts.push(
      paragraph(
        `<a href="${COMPANY.phoneHref}" style="${cssFont(block.labelStyle)}text-decoration:none;">${escapeHtml(COMPANY.phone)}</a>`,
        cssFont(block.labelStyle),
      ),
    );
  }
  if (block.showEmail) {
    lines.push(COMPANY.email);
    parts.push(
      paragraph(
        `<a href="mailto:${escapeHtml(COMPANY.email)}" style="${cssFont(block.labelStyle)}text-decoration:none;">${escapeHtml(COMPANY.email)}</a>`,
        cssFont(block.labelStyle),
      ),
    );
  }
  if (block.showLicense) {
    lines.push(COMPANY.license);
    parts.push(paragraph(escapeHtml(COMPANY.license), cssFont(block.labelStyle)));
  }
  return { html: parts.join(""), text: lines.join("\n") };
}

function renderBillTo(
  block: Extract<InvoiceLeafBlock, { type: "billTo" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const align = block.align === "right" ? "text-align:right;" : "";
  const billTo = invoice.customer;
  const lines = billTo ? formatAddressLines(billTo) : [];
  const textLines = [block.label];
  let body = "";
  if (billTo) {
    textLines.push(billTo.name, ...lines);
    body += paragraph(escapeHtml(billTo.name), cssFont(block.valueStyle));
    for (const line of lines) {
      body += paragraph(escapeHtml(line), cssFont(block.valueStyle));
    }
    if (block.showPhone && billTo.phone.trim()) {
      textLines.push(billTo.phone.trim());
      body += paragraph(escapeHtml(billTo.phone.trim()), cssFont(block.valueStyle));
    }
    if (block.showEmail && billTo.email.trim()) {
      textLines.push(billTo.email.trim());
      body += paragraph(escapeHtml(billTo.email.trim()), cssFont(block.valueStyle));
    }
  } else {
    const fallback = `Customer #${invoice.customerId}`;
    textLines.push(fallback);
    body += paragraph(escapeHtml(fallback), cssFont(block.valueStyle));
  }
  return {
    html: `<div style="${align}">${labelHtml(block.label, block.labelStyle)}${body}</div>`,
    text: textLines.join("\n"),
  };
}

function renderMeta(
  block: Extract<InvoiceLeafBlock, { type: "meta" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const fields: { label: string; value: string }[] = [];
  if (block.showIssued) fields.push({ label: "Issued", value: formatDate(invoice.issuedAt) });
  if (block.showDue) fields.push({ label: "Due", value: formatDate(invoice.dueDate) });
  if (block.showStatus) fields.push({ label: "Status", value: invoice.status });
  if (block.showPaid) fields.push({ label: "Paid", value: formatDate(invoice.paidAt) });
  if (fields.length === 0) return EMPTY;

  const width = Math.floor(100 / fields.length);
  const cells = fields
    .map(
      (field) =>
        `<td width="${width}%" valign="top" style="width:${width}%;vertical-align:top;padding:0 8px 16px 0;">${labelHtml(field.label, block.labelStyle)}${paragraph(escapeHtml(field.value), cssFont(block.valueStyle))}</td>`,
    )
    .join("");
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e5e5e5;"><tr>${cells}</tr></table>`,
    text: fields.map((field) => `${field.label}: ${field.value}`).join("\n"),
  };
}

function renderServiceAddress(
  block: Extract<InvoiceLeafBlock, { type: "serviceAddress" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const serviceAddress = invoice.serviceAddress;
  if (!showServiceAddress(invoice) || !serviceAddress) return EMPTY;
  const lines = formatAddressLines(serviceAddress);
  const textLines = [block.label];
  if (serviceAddress.label?.trim()) textLines.push(serviceAddress.label.trim());
  textLines.push(...lines);
  let body = "";
  if (serviceAddress.label?.trim()) {
    body += paragraph(escapeHtml(serviceAddress.label.trim()), cssFont(block.valueStyle));
  }
  for (const line of lines) {
    body += paragraph(escapeHtml(line), cssFont(block.valueStyle));
  }
  return {
    html: `<div style="border-bottom:1px solid #e5e5e5;padding-bottom:16px;">${labelHtml(block.label, block.labelStyle)}${body}</div>`,
    text: textLines.join("\n"),
  };
}

function renderLineItems(
  block: Extract<InvoiceLeafBlock, { type: "lineItems" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const header = `<tr><th align="left" style="padding:8px 8px 8px 0;border-bottom:1px solid #d4d4d4;${cssFont(block.labelStyle)}text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(block.descriptionLabel)}</th><th align="right" style="padding:8px 0;border-bottom:1px solid #d4d4d4;${cssFont(block.labelStyle)}text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(block.amountLabel)}</th></tr>`;
  const rows =
    invoice.lineItems.length === 0
      ? `<tr><td colspan="2" style="padding:16px 0;${cssFont(block.valueStyle)}">No line items.</td></tr>`
      : invoice.lineItems
          .map((item) => {
            const description = item.description || "";
            return `<tr><td style="padding:12px 12px 12px 0;border-bottom:1px solid #f5f5f5;${cssFont(block.valueStyle)}">${escapeHtml(description)}</td><td align="right" style="padding:12px 0;border-bottom:1px solid #f5f5f5;${cssFont(block.valueStyle)}">${escapeHtml(formatMoney(item.amountCents))}</td></tr>`;
          })
          .join("");
  const textLines = [`${block.descriptionLabel}  ${block.amountLabel}`];
  if (invoice.lineItems.length === 0) {
    textLines.push("No line items.");
  } else {
    for (const item of invoice.lineItems) {
      textLines.push(`${item.description || ""}  ${formatMoney(item.amountCents)}`);
    }
  }
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${header}${rows}</table>`,
    text: textLines.join("\n"),
  };
}

function renderNotes(
  block: Extract<InvoiceLeafBlock, { type: "notes" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const notes = invoice.workOrderNotes.filter((note) => note.content.trim());
  if (notes.length === 0) return EMPTY;
  const items = notes
    .map(
      (note) =>
        `<li style="margin:0 0 12px;${cssFont(block.valueStyle)}">${escapeHtml(note.content).replace(/\n/g, "<br />")}</li>`,
    )
    .join("");
  return {
    html: `<div style="border-top:1px solid #e5e5e5;padding-top:16px;">${labelHtml(block.label, block.labelStyle)}<ul style="margin:8px 0 0;padding:0 0 0 18px;">${items}</ul></div>`,
    text: [block.label, ...notes.map((note) => note.content.trim())].join("\n"),
  };
}

function totalsFigures(invoice: InvoiceTemplateEmailDocument): {
  subtotal: number;
  taxCents: number;
  total: number;
  hasDiscount: boolean;
  taxLabel: string;
} {
  const hasDiscount = Boolean(invoice.discountCents && invoice.discountCents > 0);
  const taxCents = invoice.taxCents ?? 0;
  const taxInclusive = invoice.originalAmountCents ?? invoice.amountCents;
  const subtotal = Math.max(taxInclusive - taxCents, 0);
  const total = hasDiscount
    ? Math.max(taxInclusive - (invoice.discountCents ?? 0), 0)
    : invoice.amountCents;
  const taxLabel =
    invoice.taxRatePercent && invoice.taxRatePercent > 0
      ? `Tax (${invoice.taxRatePercent}%)`
      : "Tax";
  return { subtotal, taxCents, total, hasDiscount, taxLabel };
}

function totalRow(label: string, value: string, style: TextStyle, emphasis = false): string {
  const padding = emphasis ? "padding:12px 0 0;" : "padding:4px 0;";
  return `<tr><td style="${padding}${cssFont(style)}">${escapeHtml(label)}</td><td align="right" style="${padding}${cssFont(style)}">${escapeHtml(value)}</td></tr>`;
}

function renderTotals(
  block: Extract<InvoiceLeafBlock, { type: "totals" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const figures = totalsFigures(invoice);
  const discountLabel = invoice.discountCode
    ? `Discount ${invoice.discountCode}`
    : "Discount";
  const rows = [
    totalRow("Subtotal", formatMoney(figures.subtotal), block.labelStyle),
    figures.hasDiscount
      ? totalRow(
          discountLabel,
          `−${formatMoney(invoice.discountCents ?? 0)}`,
          block.labelStyle,
        )
      : "",
    totalRow(figures.taxLabel, formatMoney(figures.taxCents), block.labelStyle),
    totalRow(block.totalLabel, formatMoney(figures.total), block.valueStyle, true),
  ].join("");
  const text = [
    `Subtotal: ${formatMoney(figures.subtotal)}`,
    figures.hasDiscount
      ? `${discountLabel}: −${formatMoney(invoice.discountCents ?? 0)}`
      : "",
    `${figures.taxLabel}: ${formatMoney(figures.taxCents)}`,
    `${block.totalLabel}: ${formatMoney(figures.total)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    html: `<table role="presentation" align="right" width="280" cellpadding="0" cellspacing="0" border="0" style="width:280px;margin-left:auto;"><tbody>${rows}</tbody></table>`,
    text,
  };
}

function renderPaymentMethod(
  block: Extract<InvoiceLeafBlock, { type: "paymentMethod" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const provider = invoice.paymentProvider?.trim();
  if (!provider) return EMPTY;
  const text = `${block.label}: ${provider}`;
  return {
    html: `<p style="margin:0;"><span style="${cssFont(block.labelStyle)}">${escapeHtml(block.label)}: </span><span style="${cssFont(block.valueStyle)}">${escapeHtml(provider)}</span></p>`,
    text,
  };
}

function renderColumns(
  block: Extract<InvoiceBlock, { type: "columns" }>,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const left = joinPieces(block.left.map((child) => renderLeaf(child, invoice)));
  const right = joinPieces(block.right.map((child) => renderLeaf(child, invoice)));
  if (!left.html && !right.html && !left.text && !right.text) return EMPTY;
  const [leftWidth, rightWidth] = COLUMN_SPLIT[block.split] ?? COLUMN_SPLIT[50];
  const valign =
    block.valign === "center" ? "middle" : block.valign === "bottom" ? "bottom" : "top";
  const border = block.showDivider ? "border-bottom:1px solid #e5e5e5;" : "";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${border}"><tr><td width="${leftWidth}%" valign="${valign}" style="width:${leftWidth}%;vertical-align:${valign};padding:0 12px 16px 0;">${left.html}</td><td width="${rightWidth}%" valign="${valign}" style="width:${rightWidth}%;vertical-align:${valign};padding:0 0 16px 12px;">${right.html}</td></tr></table>`;
  return { html, text: [left.text, right.text].filter(Boolean).join("\n\n") };
}

function renderBlock(
  block: InvoiceBlock,
  invoice: InvoiceTemplateEmailDocument,
): Piece {
  const piece = block.type === "columns" ? renderColumns(block, invoice) : renderLeaf(block, invoice);
  return { html: spaced(piece.html), text: piece.text };
}

function unsubscribePiece(url: string | undefined, note: string | undefined): Piece {
  const href = url?.trim();
  if (!href) return EMPTY;
  const caption = (note ?? DEFAULT_UNSUBSCRIBE_NOTE).trim();
  const html = `<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666666;text-align:center;">${
    caption ? `${escapeHtml(caption)}<br />` : ""
  }<a href="${escapeHtml(href)}" style="color:#f36c21;text-decoration:underline;">Unsubscribe</a></p>`;
  const text = [caption, `Unsubscribe: ${href}`].filter(Boolean).join("\n");
  return { html, text };
}

export function renderInvoiceTemplateEmail(input: {
  blocks: InvoiceBlock[];
  invoice: InvoiceTemplateEmailDocument;
  unsubscribeUrl?: string;
  unsubscribeNote?: string;
}): { html: string; text: string } {
  const body = joinPieces(
    input.blocks.map((block) => renderBlock(block, input.invoice)),
  );
  const documentHtml =
    body.html ||
    paragraph(
      escapeHtml(`Payment received for invoice ${input.invoice.number}.`),
      "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#231f20;",
    );
  const unsubscribe = unsubscribePiece(input.unsubscribeUrl, input.unsubscribeNote);
  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;">
          <tr>
            <td style="padding:32px 28px;text-transform:uppercase;">${documentHtml}</td>
          </tr>
        </table>
        ${unsubscribe.html}
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = [body.text, unsubscribe.text].filter(Boolean).join("\n\n");
  return { html, text };
}
