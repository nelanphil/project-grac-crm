import { z } from "zod";
import { sanitizeInvoiceTextHtml } from "../utils/invoiceTemplateHtml";

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid block id");

const alignSchema = z.enum(["left", "center", "right"]);

const fontSchema = z.enum(["inter", "georgia", "times", "arial", "courier"]);
const fontSizeSchema = z.union([
  z.literal(12),
  z.literal(14),
  z.literal(16),
  z.literal(18),
  z.literal(20),
  z.literal(24),
  z.literal(30),
  z.literal(36),
]);
const fontWeightSchema = z.union([
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
]);
const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color.");

type InvoiceTextStyle = {
  font: z.infer<typeof fontSchema>;
  size: z.infer<typeof fontSizeSchema>;
  weight: z.infer<typeof fontWeightSchema>;
  color: string;
};

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

const FIELD_STYLE_DEFAULTS = {
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
} as const satisfies Record<
  string,
  { labelStyle: InvoiceTextStyle; valueStyle: InvoiceTextStyle }
>;

export type InvoiceFieldBlockType = keyof typeof FIELD_STYLE_DEFAULTS;

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

function styleSchema(fallback: InvoiceTextStyle) {
  return z
    .object({
      font: fontSchema.optional().default(fallback.font),
      size: fontSizeSchema.optional().default(fallback.size),
      weight: fontWeightSchema.optional().default(fallback.weight),
      color: hexColorSchema.optional().default(fallback.color),
    })
    .optional()
    .default({ ...fallback });
}

const textBlockSchema = z.object({
  id: idSchema,
  type: z.literal("text"),
  html: z.string().max(10_000),
  align: alignSchema,
  tone: z.enum(["body", "muted"]),
});

const imageBlockSchema = z.object({
  id: idSchema,
  type: z.literal("image"),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) => value === "" || /^https:\/\/.+/i.test(value),
      "Use an https image URL.",
    ),
  alt: z.string().max(200),
  width: z.enum(["sm", "md", "full"]),
  align: alignSchema,
});

const spacerBlockSchema = z.object({
  id: idSchema,
  type: z.literal("spacer"),
  height: z.number().int().min(8).max(160),
});

const dividerBlockSchema = z.object({
  id: idSchema,
  type: z.literal("divider"),
});

const companyBlockSchema = z.object({
  id: idSchema,
  type: z.literal("company"),
  showName: z.boolean(),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showLicense: z.boolean(),
  labelStyle: styleSchema(fieldStylePair("company").labelStyle),
  valueStyle: styleSchema(fieldStylePair("company").valueStyle),
});

const headingBlockSchema = z.object({
  id: idSchema,
  type: z.literal("heading"),
  label: z.string().trim().min(1).max(40),
  showNumber: z.boolean(),
  showSource: z.boolean(),
  labelStyle: styleSchema(fieldStylePair("heading").labelStyle),
  valueStyle: styleSchema(fieldStylePair("heading").valueStyle),
});

const billToBlockSchema = z.object({
  id: idSchema,
  type: z.literal("billTo"),
  label: z.string().trim().min(1).max(40),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  align: alignSchema,
  labelStyle: styleSchema(fieldStylePair("billTo").labelStyle),
  valueStyle: styleSchema(fieldStylePair("billTo").valueStyle),
});

const metaBlockSchema = z.object({
  id: idSchema,
  type: z.literal("meta"),
  showIssued: z.boolean(),
  showDue: z.boolean(),
  showStatus: z.boolean(),
  showPaid: z.boolean(),
  labelStyle: styleSchema(fieldStylePair("meta").labelStyle),
  valueStyle: styleSchema(fieldStylePair("meta").valueStyle),
});

const serviceAddressBlockSchema = z.object({
  id: idSchema,
  type: z.literal("serviceAddress"),
  label: z.string().trim().min(1).max(40),
  labelStyle: styleSchema(fieldStylePair("serviceAddress").labelStyle),
  valueStyle: styleSchema(fieldStylePair("serviceAddress").valueStyle),
});

const lineItemsBlockSchema = z.object({
  id: idSchema,
  type: z.literal("lineItems"),
  descriptionLabel: z.string().trim().min(1).max(40),
  amountLabel: z.string().trim().min(1).max(40),
  labelStyle: styleSchema(fieldStylePair("lineItems").labelStyle),
  valueStyle: styleSchema(fieldStylePair("lineItems").valueStyle),
});

const notesBlockSchema = z.object({
  id: idSchema,
  type: z.literal("notes"),
  label: z.string().trim().min(1).max(40),
  labelStyle: styleSchema(fieldStylePair("notes").labelStyle),
  valueStyle: styleSchema(fieldStylePair("notes").valueStyle),
});

const totalsBlockSchema = z.object({
  id: idSchema,
  type: z.literal("totals"),
  totalLabel: z.string().trim().min(1).max(40),
  labelStyle: styleSchema(fieldStylePair("totals").labelStyle),
  valueStyle: styleSchema(fieldStylePair("totals").valueStyle),
});

const paymentMethodBlockSchema = z.object({
  id: idSchema,
  type: z.literal("paymentMethod"),
  label: z.string().trim().min(1).max(40),
  labelStyle: styleSchema(fieldStylePair("paymentMethod").labelStyle),
  valueStyle: styleSchema(fieldStylePair("paymentMethod").valueStyle),
});

const leafBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  imageBlockSchema,
  spacerBlockSchema,
  dividerBlockSchema,
  companyBlockSchema,
  headingBlockSchema,
  billToBlockSchema,
  metaBlockSchema,
  serviceAddressBlockSchema,
  lineItemsBlockSchema,
  notesBlockSchema,
  totalsBlockSchema,
  paymentMethodBlockSchema,
]);

const columnsBlockSchema = z.object({
  id: idSchema,
  type: z.literal("columns"),
  showDivider: z.boolean(),
  left: z.array(leafBlockSchema).max(20),
  right: z.array(leafBlockSchema).max(20),
});

export const invoiceBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  imageBlockSchema,
  spacerBlockSchema,
  dividerBlockSchema,
  companyBlockSchema,
  headingBlockSchema,
  billToBlockSchema,
  metaBlockSchema,
  serviceAddressBlockSchema,
  lineItemsBlockSchema,
  notesBlockSchema,
  totalsBlockSchema,
  paymentMethodBlockSchema,
  columnsBlockSchema,
]);

export type InvoiceBlock = z.infer<typeof invoiceBlockSchema>;
export type InvoiceLeafBlock = z.infer<typeof leafBlockSchema>;

function collectIds(blocks: InvoiceBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    ids.push(block.id);
    if (block.type === "columns") {
      for (const child of [...block.left, ...block.right]) ids.push(child.id);
    }
  }
  return ids;
}

export const invoiceBlocksSchema = z
  .array(invoiceBlockSchema)
  .max(40)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>();
    for (const id of collectIds(blocks)) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: "Each block needs a unique id.",
        });
        return;
      }
      seen.add(id);
    }
  });

function sanitizeLeaf(block: InvoiceLeafBlock): InvoiceLeafBlock {
  if (block.type !== "text") return block;
  return { ...block, html: sanitizeInvoiceTextHtml(block.html) };
}

export function sanitizeInvoiceBlocks(blocks: InvoiceBlock[]): InvoiceBlock[] {
  return blocks.map((block) => {
    if (block.type === "text") return sanitizeLeaf(block);
    if (block.type !== "columns") return block;
    return {
      ...block,
      left: block.left.map(sanitizeLeaf),
      right: block.right.map(sanitizeLeaf),
    };
  });
}

export const createInvoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  blocks: invoiceBlocksSchema.optional(),
});

export const updateInvoiceTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    isDefault: z.boolean().optional(),
    blocks: invoiceBlocksSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No changes to save.",
  });

export type CreateInvoiceTemplateInput = z.infer<
  typeof createInvoiceTemplateSchema
>;
export type UpdateInvoiceTemplateInput = z.infer<
  typeof updateInvoiceTemplateSchema
>;
