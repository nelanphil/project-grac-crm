import { z } from "zod";
import { sanitizeInvoiceTextHtml } from "../utils/invoiceTemplateHtml";

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid block id");

const alignSchema = z.enum(["left", "center", "right"]);

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
});

const headingBlockSchema = z.object({
  id: idSchema,
  type: z.literal("heading"),
  label: z.string().trim().min(1).max(40),
  showNumber: z.boolean(),
  showSource: z.boolean(),
});

const billToBlockSchema = z.object({
  id: idSchema,
  type: z.literal("billTo"),
  label: z.string().trim().min(1).max(40),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  align: alignSchema,
});

const metaBlockSchema = z.object({
  id: idSchema,
  type: z.literal("meta"),
  showIssued: z.boolean(),
  showDue: z.boolean(),
  showStatus: z.boolean(),
  showPaid: z.boolean(),
});

const serviceAddressBlockSchema = z.object({
  id: idSchema,
  type: z.literal("serviceAddress"),
  label: z.string().trim().min(1).max(40),
});

const lineItemsBlockSchema = z.object({
  id: idSchema,
  type: z.literal("lineItems"),
  descriptionLabel: z.string().trim().min(1).max(40),
  amountLabel: z.string().trim().min(1).max(40),
});

const notesBlockSchema = z.object({
  id: idSchema,
  type: z.literal("notes"),
  label: z.string().trim().min(1).max(40),
});

const totalsBlockSchema = z.object({
  id: idSchema,
  type: z.literal("totals"),
  totalLabel: z.string().trim().min(1).max(40),
});

const paymentMethodBlockSchema = z.object({
  id: idSchema,
  type: z.literal("paymentMethod"),
  label: z.string().trim().min(1).max(40),
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
