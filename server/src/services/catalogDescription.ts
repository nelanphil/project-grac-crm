import { Types } from "mongoose";
import { Product } from "../models/mongo/Product";

export type CatalogDescriptionPart = {
  lineType?: string | null;
  productRef?: unknown;
  contractTemplateRef?: unknown;
  catalogDescription?: string | null;
};

const MAX_CATALOG_DESCRIPTION = 2000;

export function catalogDescriptionText(value: string | null | undefined): string {
  return (value ?? "").trim().slice(0, MAX_CATALOG_DESCRIPTION);
}

function refId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return Types.ObjectId.isValid(trimmed) ? trimmed : "";
  }
  if (typeof value === "object") {
    const id = String(value);
    return Types.ObjectId.isValid(id) ? id : "";
  }
  return "";
}

function asPlain<T extends CatalogDescriptionPart>(part: T): T {
  const record = part as T & { toObject?: () => T };
  if (typeof record.toObject === "function") return record.toObject();
  return { ...part };
}

/**
 * Fill a blank catalogDescription from the linked product. Product lines use
 * productRef. Agreement lines use the contract product that owns contractTemplateRef.
 * A description already stored on the line is left as it was.
 */
export async function hydrateCatalogDescriptions<T extends CatalogDescriptionPart>(
  parts: T[],
): Promise<T[]> {
  const productIds = new Set<string>();
  const templateIds = new Set<string>();
  for (const part of parts) {
    if (part.lineType === "note") continue;
    if (catalogDescriptionText(part.catalogDescription)) continue;
    const productId = refId(part.productRef);
    if (productId) {
      productIds.add(productId);
      continue;
    }
    if (part.lineType === "agreement") {
      const templateId = refId(part.contractTemplateRef);
      if (templateId) templateIds.add(templateId);
    }
  }
  if (productIds.size === 0 && templateIds.size === 0) return parts;

  const filter = [];
  if (productIds.size > 0) filter.push({ _id: { $in: [...productIds] } });
  if (templateIds.size > 0) {
    filter.push({
      kind: "contract",
      contractTemplateRef: { $in: [...templateIds] },
    });
  }
  const products = await Product.find({ $or: filter })
    .select("notes contractTemplateRef")
    .lean();

  const notesByProduct = new Map<string, string>();
  const notesByTemplate = new Map<string, string>();
  for (const product of products) {
    const notes = catalogDescriptionText(product.notes);
    if (!notes) continue;
    notesByProduct.set(String(product._id), notes);
    const templateId = refId(product.contractTemplateRef);
    if (templateId && !notesByTemplate.has(templateId)) {
      notesByTemplate.set(templateId, notes);
    }
  }

  return parts.map((part) => {
    if (part.lineType === "note") return part;
    if (catalogDescriptionText(part.catalogDescription)) return part;
    const productId = refId(part.productRef);
    const notes = productId
      ? notesByProduct.get(productId)
      : part.lineType === "agreement"
        ? notesByTemplate.get(refId(part.contractTemplateRef))
        : undefined;
    if (!notes) return part;
    return { ...asPlain(part), catalogDescription: notes };
  });
}

export async function hydrateRecordParts<T extends object>(
  records: T[],
): Promise<T[]> {
  const flat: CatalogDescriptionPart[] = [];
  const spans: Array<{ start: number; count: number }> = [];
  for (const record of records) {
    const parts = Array.isArray((record as { parts?: unknown }).parts)
      ? ((record as { parts: CatalogDescriptionPart[] }).parts)
      : [];
    spans.push({ start: flat.length, count: parts.length });
    flat.push(...parts);
  }
  if (flat.length === 0) return records;
  const hydrated = await hydrateCatalogDescriptions(flat);
  return records.map((record, index) => {
    const span = spans[index];
    if (!span?.count) return record;
    return {
      ...record,
      parts: hydrated.slice(span.start, span.start + span.count),
    };
  });
}
