import type { InvoiceItem } from "@/lib/api";

export type InvoiceAlign = "left" | "center" | "right";
export type InvoiceTextTone = "body" | "muted";
export type InvoiceImageWidth = "sm" | "md" | "full";

export const INVOICE_FONTS = ["inter", "georgia", "times", "arial", "courier"] as const;
export type InvoiceFont = (typeof INVOICE_FONTS)[number];

export const INVOICE_FONT_LABELS: Record<InvoiceFont, string> = {
  inter: "Inter",
  georgia: "Georgia",
  times: "Times New Roman",
  arial: "Arial",
  courier: "Courier New",
};

export const INVOICE_FONT_STACK: Record<InvoiceFont, string> = {
  inter: "var(--font-inter), system-ui, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
  arial: "Arial, Helvetica, sans-serif",
  courier: "'Courier New', Courier, monospace",
};

export const INVOICE_FONT_SIZES = [12, 14, 16, 18, 20, 24, 30, 36] as const;
export type InvoiceFontSize = (typeof INVOICE_FONT_SIZES)[number];

export const INVOICE_FONT_WEIGHTS = [400, 500, 600, 700] as const;
export type InvoiceFontWeight = (typeof INVOICE_FONT_WEIGHTS)[number];

export const INVOICE_FONT_WEIGHT_LABELS: Record<InvoiceFontWeight, string> = {
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
};

export interface InvoiceTextStyle {
  font: InvoiceFont;
  size: InvoiceFontSize;
  weight: InvoiceFontWeight;
  color: string;
}

export const FIELD_BLOCK_TYPES = [
  "company",
  "heading",
  "billTo",
  "meta",
  "serviceAddress",
  "lineItems",
  "notes",
  "totals",
  "paymentMethod",
] as const;
export type InvoiceFieldBlockType = (typeof FIELD_BLOCK_TYPES)[number];

const captionStyle: InvoiceTextStyle = {
  font: "inter",
  size: 12,
  weight: 600,
  color: "#737373",
};
const bodyStyle: InvoiceTextStyle = {
  font: "inter",
  size: 14,
  weight: 400,
  color: "#404040",
};
const nameStyle: InvoiceTextStyle = {
  font: "inter",
  size: 14,
  weight: 600,
  color: "#231f20",
};

/** Keep in sync with server/src/schemas/invoiceTemplate.schema.ts */
export const FIELD_STYLE_DEFAULTS: Record<
  InvoiceFieldBlockType,
  { labelStyle: InvoiceTextStyle; valueStyle: InvoiceTextStyle }
> = {
  company: {
    labelStyle: { font: "inter", size: 14, weight: 400, color: "#666666" },
    valueStyle: nameStyle,
  },
  heading: {
    labelStyle: captionStyle,
    valueStyle: { font: "inter", size: 24, weight: 700, color: "#231f20" },
  },
  billTo: { labelStyle: captionStyle, valueStyle: nameStyle },
  meta: {
    labelStyle: captionStyle,
    valueStyle: { font: "inter", size: 14, weight: 500, color: "#231f20" },
  },
  serviceAddress: { labelStyle: captionStyle, valueStyle: bodyStyle },
  lineItems: { labelStyle: captionStyle, valueStyle: bodyStyle },
  notes: { labelStyle: captionStyle, valueStyle: bodyStyle },
  totals: {
    labelStyle: { font: "inter", size: 14, weight: 400, color: "#666666" },
    valueStyle: { font: "inter", size: 16, weight: 600, color: "#231f20" },
  },
  paymentMethod: {
    labelStyle: { font: "inter", size: 12, weight: 400, color: "#737373" },
    valueStyle: { font: "inter", size: 12, weight: 400, color: "#737373" },
  },
};

export function fieldStylePair(type: InvoiceFieldBlockType): {
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
} {
  const styles = FIELD_STYLE_DEFAULTS[type];
  return {
    labelStyle: { ...styles.labelStyle },
    valueStyle: { ...styles.valueStyle },
  };
}

export function invoiceTextCss(style: InvoiceTextStyle): {
  fontFamily: string;
  fontSize: string;
  fontWeight: number;
  color: string;
} {
  return {
    fontFamily: INVOICE_FONT_STACK[style.font],
    fontSize: `${style.size / 16}rem`,
    fontWeight: style.weight,
    color: style.color,
  };
}

export function colorInputValue(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(color);
  if (!short) return "#737373";
  return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
}

export interface InvoiceTextBlock {
  id: string;
  type: "text";
  html: string;
  align: InvoiceAlign;
  tone: InvoiceTextTone;
}

export interface InvoiceImageBlock {
  id: string;
  type: "image";
  url: string;
  alt: string;
  width: InvoiceImageWidth;
  align: InvoiceAlign;
}

export interface InvoiceSpacerBlock {
  id: string;
  type: "spacer";
  height: number;
}

export interface InvoiceDividerBlock {
  id: string;
  type: "divider";
}

export interface InvoiceCompanyBlock {
  id: string;
  type: "company";
  showName: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showLicense: boolean;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceHeadingBlock {
  id: string;
  type: "heading";
  label: string;
  showNumber: boolean;
  showSource: boolean;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceBillToBlock {
  id: string;
  type: "billTo";
  label: string;
  showPhone: boolean;
  showEmail: boolean;
  align: InvoiceAlign;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceMetaBlock {
  id: string;
  type: "meta";
  showIssued: boolean;
  showDue: boolean;
  showStatus: boolean;
  showPaid: boolean;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceServiceAddressBlock {
  id: string;
  type: "serviceAddress";
  label: string;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceLineItemsBlock {
  id: string;
  type: "lineItems";
  descriptionLabel: string;
  amountLabel: string;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceNotesBlock {
  id: string;
  type: "notes";
  label: string;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoiceTotalsBlock {
  id: string;
  type: "totals";
  totalLabel: string;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export interface InvoicePaymentMethodBlock {
  id: string;
  type: "paymentMethod";
  label: string;
  labelStyle: InvoiceTextStyle;
  valueStyle: InvoiceTextStyle;
}

export type InvoiceLeafBlock =
  | InvoiceTextBlock
  | InvoiceImageBlock
  | InvoiceSpacerBlock
  | InvoiceDividerBlock
  | InvoiceCompanyBlock
  | InvoiceHeadingBlock
  | InvoiceBillToBlock
  | InvoiceMetaBlock
  | InvoiceServiceAddressBlock
  | InvoiceLineItemsBlock
  | InvoiceNotesBlock
  | InvoiceTotalsBlock
  | InvoicePaymentMethodBlock;

export interface InvoiceColumnsBlock {
  id: string;
  type: "columns";
  showDivider: boolean;
  left: InvoiceLeafBlock[];
  right: InvoiceLeafBlock[];
}

export type InvoiceBlock = InvoiceLeafBlock | InvoiceColumnsBlock;

export type InvoiceBlockType = InvoiceBlock["type"];

export const BLOCK_CATALOG: {
  type: InvoiceBlockType;
  label: string;
  group: "content" | "invoice";
}[] = [
  { type: "text", label: "Text", group: "content" },
  { type: "image", label: "Image", group: "content" },
  { type: "spacer", label: "Spacer", group: "content" },
  { type: "divider", label: "Divider", group: "content" },
  { type: "columns", label: "Two columns", group: "content" },
  { type: "company", label: "Company", group: "invoice" },
  { type: "heading", label: "Invoice heading", group: "invoice" },
  { type: "billTo", label: "Bill to", group: "invoice" },
  { type: "meta", label: "Dates and status", group: "invoice" },
  { type: "serviceAddress", label: "Service address", group: "invoice" },
  { type: "lineItems", label: "Line items", group: "invoice" },
  { type: "notes", label: "Notes", group: "invoice" },
  { type: "totals", label: "Totals", group: "invoice" },
  { type: "paymentMethod", label: "Payment method", group: "invoice" },
];

const DEFAULT_BLOCKS: InvoiceBlock[] = [
  {
    id: "header-columns",
    type: "columns",
    showDivider: true,
    left: [
      {
        id: "heading",
        type: "heading",
        label: "Invoice",
        showNumber: true,
        showSource: true,
        ...fieldStylePair("heading"),
      },
      {
        id: "company",
        type: "company",
        showName: true,
        showPhone: true,
        showEmail: true,
        showLicense: true,
        ...fieldStylePair("company"),
      },
    ],
    right: [
      {
        id: "bill-to",
        type: "billTo",
        label: "Bill to",
        showPhone: true,
        showEmail: true,
        align: "right",
        ...fieldStylePair("billTo"),
      },
    ],
  },
  {
    id: "meta",
    type: "meta",
    showIssued: true,
    showDue: true,
    showStatus: true,
    showPaid: true,
    ...fieldStylePair("meta"),
  },
  {
    id: "service-address",
    type: "serviceAddress",
    label: "Service address",
    ...fieldStylePair("serviceAddress"),
  },
  {
    id: "line-items",
    type: "lineItems",
    descriptionLabel: "Description",
    amountLabel: "Amount",
    ...fieldStylePair("lineItems"),
  },
  {
    id: "totals",
    type: "totals",
    totalLabel: "Total due",
    ...fieldStylePair("totals"),
  },
  {
    id: "notes",
    type: "notes",
    label: "Notes",
    ...fieldStylePair("notes"),
  },
  {
    id: "payment-method",
    type: "paymentMethod",
    label: "Payment method",
    ...fieldStylePair("paymentMethod"),
  },
  {
    id: "footer",
    type: "text",
    align: "center",
    tone: "muted",
    html: "<p>Thank you for your business.</p><p>Questions? Call (386) 631-8982 or email info@generatormaintenancefl.com</p>",
  },
];

export function defaultInvoiceBlocks(): InvoiceBlock[] {
  return structuredClone(DEFAULT_BLOCKS);
}

export function newBlockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createBlock(type: InvoiceBlockType): InvoiceBlock {
  const id = newBlockId();
  switch (type) {
    case "text":
      return { id, type, html: "<p></p>", align: "left", tone: "body" };
    case "image":
      return { id, type, url: "", alt: "", width: "md", align: "center" };
    case "spacer":
      return { id, type, height: 24 };
    case "divider":
      return { id, type };
    case "company":
      return {
        id,
        type,
        showName: true,
        showPhone: true,
        showEmail: true,
        showLicense: true,
        ...fieldStylePair("company"),
      };
    case "heading":
      return {
        id,
        type,
        label: "Invoice",
        showNumber: true,
        showSource: true,
        ...fieldStylePair("heading"),
      };
    case "billTo":
      return {
        id,
        type,
        label: "Bill to",
        showPhone: true,
        showEmail: true,
        align: "left",
        ...fieldStylePair("billTo"),
      };
    case "meta":
      return {
        id,
        type,
        showIssued: true,
        showDue: true,
        showStatus: true,
        showPaid: true,
        ...fieldStylePair("meta"),
      };
    case "serviceAddress":
      return { id, type, label: "Service address", ...fieldStylePair("serviceAddress") };
    case "lineItems":
      return {
        id,
        type,
        descriptionLabel: "Description",
        amountLabel: "Amount",
        ...fieldStylePair("lineItems"),
      };
    case "notes":
      return { id, type, label: "Notes", ...fieldStylePair("notes") };
    case "totals":
      return { id, type, totalLabel: "Total due", ...fieldStylePair("totals") };
    case "paymentMethod":
      return { id, type, label: "Payment method", ...fieldStylePair("paymentMethod") };
    case "columns":
      return { id, type, showDivider: false, left: [], right: [] };
  }
}

export function blockLabel(type: InvoiceBlockType): string {
  return BLOCK_CATALOG.find((item) => item.type === type)?.label ?? type;
}

type BlockLocation =
  | { scope: "root"; index: number }
  | { scope: "column"; columnId: string; side: "left" | "right"; index: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readAlign(value: unknown, fallback: InvoiceAlign): InvoiceAlign {
  return value === "left" || value === "center" || value === "right" ? value : fallback;
}

function readStyle(value: unknown, fallback: InvoiceTextStyle): InvoiceTextStyle {
  const record = isRecord(value) ? value : {};
  const font = INVOICE_FONTS.find((item) => item === record.font) ?? fallback.font;
  const size = INVOICE_FONT_SIZES.find((item) => item === record.size) ?? fallback.size;
  const weight = INVOICE_FONT_WEIGHTS.find((item) => item === record.weight) ?? fallback.weight;
  const color =
    typeof record.color === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(record.color)
      ? record.color
      : fallback.color;
  return { font, size, weight, color };
}

function readFieldStyles(
  value: Record<string, unknown>,
  type: InvoiceFieldBlockType,
): { labelStyle: InvoiceTextStyle; valueStyle: InvoiceTextStyle } {
  const defaults = fieldStylePair(type);
  return {
    labelStyle: readStyle(value.labelStyle, defaults.labelStyle),
    valueStyle: readStyle(value.valueStyle, defaults.valueStyle),
  };
}

function parseLeaf(value: unknown): InvoiceLeafBlock | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
    return null;
  }
  const id = value.id;
  switch (value.type) {
    case "text":
      return {
        id,
        type: "text",
        html: readString(value.html, "<p></p>"),
        align: readAlign(value.align, "left"),
        tone: value.tone === "muted" ? "muted" : "body",
      };
    case "image":
      return {
        id,
        type: "image",
        url: readString(value.url, ""),
        alt: readString(value.alt, ""),
        width: value.width === "sm" || value.width === "full" ? value.width : "md",
        align: readAlign(value.align, "center"),
      };
    case "spacer":
      return {
        id,
        type: "spacer",
        height: Math.min(160, Math.max(8, Number(value.height) || 24)),
      };
    case "divider":
      return { id, type: "divider" };
    case "company":
      return {
        id,
        type: "company",
        showName: readBool(value.showName, true),
        showPhone: readBool(value.showPhone, true),
        showEmail: readBool(value.showEmail, true),
        showLicense: readBool(value.showLicense, true),
        ...readFieldStyles(value, "company"),
      };
    case "heading":
      return {
        id,
        type: "heading",
        label: readString(value.label, "Invoice") || "Invoice",
        showNumber: readBool(value.showNumber, true),
        showSource: readBool(value.showSource, true),
        ...readFieldStyles(value, "heading"),
      };
    case "billTo":
      return {
        id,
        type: "billTo",
        label: readString(value.label, "Bill to") || "Bill to",
        showPhone: readBool(value.showPhone, true),
        showEmail: readBool(value.showEmail, true),
        align: readAlign(value.align, "left"),
        ...readFieldStyles(value, "billTo"),
      };
    case "meta":
      return {
        id,
        type: "meta",
        showIssued: readBool(value.showIssued, true),
        showDue: readBool(value.showDue, true),
        showStatus: readBool(value.showStatus, true),
        showPaid: readBool(value.showPaid, true),
        ...readFieldStyles(value, "meta"),
      };
    case "serviceAddress":
      return {
        id,
        type: "serviceAddress",
        label: readString(value.label, "Service address") || "Service address",
        ...readFieldStyles(value, "serviceAddress"),
      };
    case "lineItems":
      return {
        id,
        type: "lineItems",
        descriptionLabel: readString(value.descriptionLabel, "Description") || "Description",
        amountLabel: readString(value.amountLabel, "Amount") || "Amount",
        ...readFieldStyles(value, "lineItems"),
      };
    case "notes":
      return {
        id,
        type: "notes",
        label: readString(value.label, "Notes") || "Notes",
        ...readFieldStyles(value, "notes"),
      };
    case "totals":
      return {
        id,
        type: "totals",
        totalLabel: readString(value.totalLabel, "Total due") || "Total due",
        ...readFieldStyles(value, "totals"),
      };
    case "paymentMethod":
      return {
        id,
        type: "paymentMethod",
        label: readString(value.label, "Payment method") || "Payment method",
        ...readFieldStyles(value, "paymentMethod"),
      };
    default:
      return null;
  }
}

export function normalizeBlocks(input: unknown): InvoiceBlock[] {
  if (!Array.isArray(input)) return defaultInvoiceBlocks();
  const blocks: InvoiceBlock[] = [];
  for (const item of input) {
    if (!isRecord(item) || item.type !== "columns") {
      const leaf = parseLeaf(item);
      if (leaf) blocks.push(leaf);
      continue;
    }
    if (typeof item.id !== "string") continue;
    blocks.push({
      id: item.id,
      type: "columns",
      showDivider: readBool(item.showDivider, false),
      left: Array.isArray(item.left)
        ? item.left.map(parseLeaf).filter((block): block is InvoiceLeafBlock => block != null)
        : [],
      right: Array.isArray(item.right)
        ? item.right.map(parseLeaf).filter((block): block is InvoiceLeafBlock => block != null)
        : [],
    });
  }
  return blocks;
}

function locate(blocks: InvoiceBlock[], id: string): BlockLocation | null {
  const rootIndex = blocks.findIndex((block) => block.id === id);
  if (rootIndex >= 0) return { scope: "root", index: rootIndex };
  for (const block of blocks) {
    if (block.type !== "columns") continue;
    const left = block.left.findIndex((child) => child.id === id);
    if (left >= 0) {
      return { scope: "column", columnId: block.id, side: "left", index: left };
    }
    const right = block.right.findIndex((child) => child.id === id);
    if (right >= 0) {
      return { scope: "column", columnId: block.id, side: "right", index: right };
    }
  }
  return null;
}

function listAt(blocks: InvoiceBlock[], location: BlockLocation): InvoiceBlock[] {
  if (location.scope === "root") return blocks;
  const column = blocks.find((block) => block.id === location.columnId);
  if (!column || column.type !== "columns") return [];
  return column[location.side];
}

function replaceList(
  blocks: InvoiceBlock[],
  location: BlockLocation,
  next: InvoiceBlock[],
): InvoiceBlock[] {
  if (location.scope === "root") return next;
  return blocks.map((block) => {
    if (block.id !== location.columnId || block.type !== "columns") return block;
    const leaves = next.filter((item): item is InvoiceLeafBlock => item.type !== "columns");
    return {
      ...block,
      [location.side]: leaves,
    };
  });
}

export function findBlock(blocks: InvoiceBlock[], id: string | null): InvoiceBlock | null {
  if (!id) return null;
  const location = locate(blocks, id);
  if (!location) return null;
  return listAt(blocks, location)[location.index] ?? null;
}

export function patchBlock(
  blocks: InvoiceBlock[],
  id: string,
  patch: Record<string, unknown>,
): InvoiceBlock[] {
  const location = locate(blocks, id);
  if (!location) return blocks;
  const list = listAt(blocks, location).slice();
  const current = list[location.index];
  if (!current) return blocks;
  const next = { ...current } as InvoiceBlock & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id" || key === "type" || key === "left" || key === "right") continue;
    next[key] = value;
  }
  list[location.index] = next;
  return replaceList(blocks, location, list);
}

export function removeBlock(blocks: InvoiceBlock[], id: string): InvoiceBlock[] {
  const location = locate(blocks, id);
  if (!location) return blocks;
  const list = listAt(blocks, location).slice();
  list.splice(location.index, 1);
  return replaceList(blocks, location, list);
}

function cloneWithNewIds(block: InvoiceBlock): InvoiceBlock {
  if (block.type !== "columns") return { ...block, id: newBlockId() };
  return {
    ...block,
    id: newBlockId(),
    left: block.left.map((child) => ({ ...child, id: newBlockId() })),
    right: block.right.map((child) => ({ ...child, id: newBlockId() })),
  };
}

export function duplicateBlock(
  blocks: InvoiceBlock[],
  id: string,
): { blocks: InvoiceBlock[]; id: string } {
  const location = locate(blocks, id);
  if (!location) return { blocks, id };
  const list = listAt(blocks, location).slice();
  const current = list[location.index];
  if (!current) return { blocks, id };
  const copy = cloneWithNewIds(current);
  if (location.scope === "column" && copy.type === "columns") {
    const rootIndex = blocks.findIndex((block) => block.id === location.columnId);
    const next = blocks.slice();
    next.splice(rootIndex + 1, 0, copy);
    return { blocks: next, id: copy.id };
  }
  list.splice(location.index + 1, 0, copy);
  return { blocks: replaceList(blocks, location, list), id: copy.id };
}

export function moveBlock(
  blocks: InvoiceBlock[],
  id: string,
  direction: -1 | 1,
): InvoiceBlock[] {
  const location = locate(blocks, id);
  if (!location) return blocks;
  const list = listAt(blocks, location).slice();
  const target = location.index + direction;
  if (target < 0 || target >= list.length) return blocks;
  const [item] = list.splice(location.index, 1);
  if (!item) return blocks;
  list.splice(target, 0, item);
  return replaceList(blocks, location, list);
}

export function siblingMeta(
  blocks: InvoiceBlock[],
  id: string,
): { index: number; count: number } | null {
  const location = locate(blocks, id);
  if (!location) return null;
  return { index: location.index, count: listAt(blocks, location).length };
}

export function insertBlock(
  blocks: InvoiceBlock[],
  block: InvoiceBlock,
  selectedId: string | null,
): InvoiceBlock[] {
  if (!selectedId) return [...blocks, block];
  const location = locate(blocks, selectedId);
  if (!location) return [...blocks, block];

  if (block.type === "columns") {
    if (location.scope === "root") {
      const next = blocks.slice();
      next.splice(location.index + 1, 0, block);
      return next;
    }
    const parentIndex = blocks.findIndex((item) => item.id === location.columnId);
    const next = blocks.slice();
    next.splice(parentIndex + 1, 0, block);
    return next;
  }

  if (location.scope === "column") {
    const list = listAt(blocks, location).slice();
    list.splice(location.index + 1, 0, block);
    return replaceList(blocks, location, list);
  }

  const selected = blocks[location.index];
  if (selected?.type === "columns") {
    return blocks.map((item) => {
      if (item.id !== selected.id || item.type !== "columns") return item;
      return { ...item, left: [...item.left, block] };
    });
  }

  const next = blocks.slice();
  next.splice(location.index + 1, 0, block);
  return next;
}

export function insertIntoColumn(
  blocks: InvoiceBlock[],
  columnId: string,
  side: "left" | "right",
  block: InvoiceLeafBlock,
): InvoiceBlock[] {
  return blocks.map((item) => {
    if (item.id !== columnId || item.type !== "columns") return item;
    return { ...item, [side]: [...item[side], block] };
  });
}

export function reorderBlock(
  blocks: InvoiceBlock[],
  activeId: string,
  overId: string,
): InvoiceBlock[] {
  if (activeId === overId) return blocks;
  const from = locate(blocks, activeId);
  const to = locate(blocks, overId);
  if (!from || !to || from.scope !== to.scope) return blocks;
  if (
    from.scope === "column" &&
    to.scope === "column" &&
    (from.columnId !== to.columnId || from.side !== to.side)
  ) {
    return blocks;
  }
  const list = listAt(blocks, from).slice();
  const fromIndex = list.findIndex((item) => item.id === activeId);
  const toIndex = list.findIndex((item) => item.id === overId);
  if (fromIndex < 0 || toIndex < 0) return blocks;
  const [item] = list.splice(fromIndex, 1);
  if (!item) return blocks;
  list.splice(toIndex, 0, item);
  return replaceList(blocks, from, list);
}

export function withNewIds(blocks: InvoiceBlock[]): InvoiceBlock[] {
  return blocks.map(cloneWithNewIds);
}

export const SAMPLE_INVOICE: InvoiceItem = {
  _id: "sample-invoice",
  number: "INV-1042",
  customerId: 1001,
  customerRef: null,
  sourceType: "work_order",
  contractRef: null,
  workOrderRef: null,
  templateRef: null,
  lineItems: [
    { description: "Annual generator maintenance", amountCents: 18900 },
    { description: "Air filter", amountCents: 4200 },
  ],
  amountCents: 20600,
  originalAmountCents: 23100,
  discountCode: "SPRING",
  discountCents: 2500,
  currency: "usd",
  status: "open",
  dueDate: "2026-04-15T00:00:00.000Z",
  issuedAt: "2026-03-15T00:00:00.000Z",
  paidAt: null,
  paymentProvider: "square",
  providerCheckoutId: null,
  providerOrderId: null,
  providerPaymentId: null,
  hasPayLink: false,
  payTokenExpiresAt: null,
  metadata: {},
  createdAt: "2026-03-15T00:00:00.000Z",
  updatedAt: "2026-03-15T00:00:00.000Z",
  customer: {
    name: "Jordan Hale",
    accountNumber: 1001,
    address: "18 Palm Court",
    city: "Orlando",
    state: "FL",
    zip: "32801",
    phone: "(407) 555-0148",
    email: "jordan@example.com",
  },
  serviceAddress: {
    label: "Lake house",
    address: "420 Shoreline Drive",
    city: "Winter Park",
    state: "FL",
    zip: "32789",
  },
  workOrderNotes: [
    {
      _id: "sample-note",
      content: "Replaced the air filter. Next service is due in 12 months.",
      visibleToCustomer: true,
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    },
  ],
};
