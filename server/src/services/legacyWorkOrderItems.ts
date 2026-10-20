import { Model, Types } from "mongoose";
import type { IProduct } from "../models/mongo/Product";
import {
  computeTicketTotals,
  normalizeParts,
  type NormalizedTicketPart,
} from "./serviceTicket";
import { normalizeProductCode } from "../utils/productCodes";

export type LegacyCatalogProduct = {
  _id: string;
  productCode?: string;
  partNumber?: string;
  name?: string;
  kind?: "part" | "labor" | string;
  listPrice?: number;
  unitPrice?: number;
  active?: boolean;
};

export type LegacyWorkOrderMoneyInput = {
  descPerform?: string;
  descPerformed?: string;
  totalParts?: number;
  totalLabor?: number;
  miscExp?: number;
  subtotal?: number;
  shipping?: number;
  total?: number;
  laborHours?: number;
};

export type LegacyMappedWorkOrderMoney = {
  parts: NormalizedTicketPart[];
  laborHours: number;
  laborOverridden: boolean;
  totalParts: number;
  totalLabor: number;
  totalAgreements: number;
  miscExp: number;
  shipping: number;
  subtotal: number;
  total: number;
};

type DetectedItem = {
  key: string;
  kind: "part" | "labor";
  partNumber: string;
  description: string;
  productRef: string | null;
  listPrice: number;
  addon: boolean;
  score: number;
};

const MONEY_EPS = 0.009;

const ADDON_RULES: Array<{
  key: string;
  kind: "part" | "labor";
  partNumber: string;
  description: string;
  pattern: RegExp;
  addon: boolean;
  score: number;
}> = [
  {
    key: "asc",
    kind: "labor",
    partNumber: "ASC",
    description: "ANNUAL SERVICE",
    pattern: /\b(?:asc|acs|annual\s+service(?:\s+contract)?)\b/i,
    addon: false,
    score: 100,
  },
  {
    key: "labor",
    kind: "labor",
    partNumber: "LABOR",
    description: "LABOR",
    pattern: /\b(?:labor|service\s+call|diag(?:nostic)?s?)\b/i,
    addon: false,
    score: 70,
  },
  {
    key: "battery",
    kind: "part",
    partNumber: "BATTERY",
    description: "BATTERY",
    pattern: /\bbatter(?:y|ies)\b/i,
    addon: true,
    score: 80,
  },
  {
    key: "oil-filter",
    kind: "part",
    partNumber: "OILFILTER",
    description: "OIL FILTER",
    pattern: /\boil\s*filters?\b/i,
    addon: true,
    score: 75,
  },
  {
    key: "air-filter",
    kind: "part",
    partNumber: "AIRFILTER",
    description: "AIR FILTER",
    pattern: /\bair\s*filters?\b/i,
    addon: true,
    score: 75,
  },
  {
    key: "spark-plug",
    kind: "part",
    partNumber: "SPARKPLUG",
    description: "SPARK PLUGS",
    pattern: /\b(?:spark\s*)?plugs?\b/i,
    addon: true,
    score: 60,
  },
  {
    key: "carb",
    kind: "part",
    partNumber: "CARB",
    description: "CARBURETOR",
    pattern: /\bcarb(?:uretor)?s?\b/i,
    addon: true,
    score: 65,
  },
  {
    key: "starter",
    kind: "part",
    partNumber: "STARTER",
    description: "STARTER",
    pattern: /\bstarters?\b/i,
    addon: true,
    score: 65,
  },
  {
    key: "control-board",
    kind: "part",
    partNumber: "CTRLBOARD",
    description: "CONTROL BOARD",
    pattern: /\b(?:control\s+board|\bcb\b)\b/i,
    addon: true,
    score: 60,
  },
];

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function money(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

function unescapeDumpText(text: string): string {
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

function combinedText(input: LegacyWorkOrderMoneyInput): string {
  return `${unescapeDumpText(input.descPerform ?? "")}\n${unescapeDumpText(input.descPerformed ?? "")}`;
}


/**
 * ASC / service list price written in the job description.
 * Accepts "ASC $300 PLUS PARTS" and "ASC 300". Ignores time windows
 * ("ASC 8-10") and dates ("ASC 1/17/24", "asc 12/19/23").
 */
export function extractQuotedServicePrice(text: string): number {
  const source = text ?? "";
  const patterns = [
    /(?:asc|acs)\s*\$\s*(\d+(?:\.\d{1,2})?)/i,
    /\$\s*(\d+(?:\.\d{1,2})?)\s*plus\s+parts/i,
    /(?:asc|acs)\s*\$?\s*(\d{2,5}(?:\.\d{1,2})?)(?![-/\d])/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const amount = money(match[1]);
    if (amount > 0) return amount;
  }
  return 0;
}

function catalogCode(product: LegacyCatalogProduct): string {
  return normalizeProductCode(product.productCode || product.partNumber || "");
}

function catalogPrice(product: LegacyCatalogProduct): number {
  return money(product.listPrice ?? product.unitPrice);
}

function wordBoundaryIncludes(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, "i").test(
    haystack,
  );
}

function matchCatalogProducts(
  text: string,
  catalog: LegacyCatalogProduct[],
  core: number,
): DetectedItem[] {
  if (!text.trim() || catalog.length === 0) return [];
  const matches: DetectedItem[] = [];
  for (const product of catalog) {
    const code = catalogCode(product);
    const name = (product.name ?? "").trim();
    let score = 0;
    if (code.length >= 3 && wordBoundaryIncludes(text, code)) score += 120;
    if (name.length >= 5 && wordBoundaryIncludes(text, name)) {
      score += Math.min(80, name.length);
    }
    if (score === 0) continue;

    const listPrice = catalogPrice(product);
    if (listPrice > 0 && core > 0 && listPrice > core + 0.05) {
      continue;
    }

    const kind = product.kind === "labor" ? "labor" : "part";
    matches.push({
      key: `catalog:${product._id}`,
      kind,
      partNumber: code || name.toUpperCase(),
      description: (name || code || "PRODUCT").toUpperCase(),
      productRef: product._id,
      listPrice,
      addon: kind === "part",
      score,
    });
  }
  matches.sort((a, b) => b.score - a.score || b.listPrice - a.listPrice);
  return matches;
}

function matchKeywordItems(text: string): DetectedItem[] {
  if (!text.trim()) return [];
  const matches: DetectedItem[] = [];
  for (const rule of ADDON_RULES) {
    if (!rule.pattern.test(text)) continue;
    matches.push({
      key: `kw:${rule.key}`,
      kind: rule.kind,
      partNumber: rule.partNumber,
      description: rule.description,
      productRef: null,
      listPrice: 0,
      addon: rule.addon,
      score: rule.score,
    });
  }
  return matches;
}

function itemCoveredByCatalog(
  item: DetectedItem,
  catalogMatches: DetectedItem[],
): boolean {
  const token = item.partNumber.toLowerCase();
  const words = item.description.toLowerCase().split(/\s+/);
  return catalogMatches.some((match) => {
    const hay = `${match.partNumber} ${match.description}`.toLowerCase();
    return (
      (token.length >= 3 && hay.includes(token.toLowerCase())) ||
      words.every((word) => word.length < 3 || hay.includes(word))
    );
  });
}

function mergeDetections(
  catalogMatches: DetectedItem[],
  keywordMatches: DetectedItem[],
): DetectedItem[] {
  const merged = [...catalogMatches];
  for (const item of keywordMatches) {
    if (itemCoveredByCatalog(item, catalogMatches)) continue;
    merged.push(item);
  }
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

function lineFromDetection(
  item: DetectedItem,
  amount: number,
): NormalizedTicketPart {
  const qty = 1;
  const unitPrice = roundMoney(amount);
  return {
    productRef: item.productRef,
    contractTemplateRef: null,
    enrolledContractRef: null,
    lineType: "product",
    kind: item.kind,
    partNumber: item.partNumber,
    description: item.description,
    quantity: qty,
    unitPrice,
    listPrice: item.listPrice > 0 ? item.listPrice : unitPrice,
    priceOverridden: item.listPrice <= 0 || item.listPrice !== unitPrice,
    amount: unitPrice,
  };
}

function genericLine(
  kind: "part" | "labor",
  description: string,
  partNumber: string,
  amount: number,
): NormalizedTicketPart {
  const unitPrice = roundMoney(amount);
  return {
    productRef: null,
    contractTemplateRef: null,
    enrolledContractRef: null,
    lineType: "product",
    kind,
    partNumber,
    description,
    quantity: 1,
    unitPrice,
    listPrice: unitPrice,
    priceOverridden: true,
    amount: unitPrice,
  };
}

function noteLine(description: string): NormalizedTicketPart {
  return {
    productRef: null,
    contractTemplateRef: null,
    enrolledContractRef: null,
    lineType: "note",
    kind: "part",
    partNumber: "",
    description,
    quantity: 0,
    unitPrice: 0,
    listPrice: 0,
    priceOverridden: false,
    amount: 0,
  };
}

function allocateKind(
  items: DetectedItem[],
  budget: number,
  kind: "part" | "labor",
  fallbackDescription: string,
  fallbackCode: string,
): NormalizedTicketPart[] {
  const lines: NormalizedTicketPart[] = [];
  if (budget <= MONEY_EPS) {
    for (const item of items) {
      lines.push(noteLine(`${item.description} (imported, no amount split)`));
    }
    return lines;
  }

  if (items.length === 0) {
    return [genericLine(kind, fallbackDescription, fallbackCode, budget)];
  }

  const priced = items.filter((item) => item.listPrice > MONEY_EPS);
  const pricedTotal = roundMoney(
    priced.reduce((sum, item) => sum + item.listPrice, 0),
  );
  if (
    priced.length > 0 &&
    pricedTotal > MONEY_EPS &&
    pricedTotal <= budget + MONEY_EPS
  ) {
    let remaining = budget;
    for (const item of priced) {
      const amount = Math.min(item.listPrice, remaining);
      lines.push(lineFromDetection(item, amount));
      remaining = roundMoney(remaining - amount);
    }
    const unpriced = items.filter((item) => item.listPrice <= MONEY_EPS);
    if (remaining > MONEY_EPS) {
      if (unpriced[0]) {
        lines.push(lineFromDetection(unpriced[0], remaining));
        remaining = 0;
        for (const extra of unpriced.slice(1)) {
          lines.push(noteLine(`${extra.description} (imported)`));
        }
      } else {
        lines[0] = lineFromDetection(priced[0]!, roundMoney(priced[0]!.listPrice + remaining));
      }
    } else {
      for (const extra of unpriced) {
        lines.push(noteLine(`${extra.description} (imported)`));
      }
    }
    return lines;
  }

  lines.push(lineFromDetection(items[0]!, budget));
  for (const extra of items.slice(1)) {
    lines.push(noteLine(`${extra.description} (imported)`));
  }
  return lines;
}

export function hasPricedProductLines(
  parts: Array<{ lineType?: string }> | undefined,
): boolean {
  return (parts ?? []).some((part) => part.lineType !== "note");
}

export function legacyWorkOrderHasBillableMoney(
  input: LegacyWorkOrderMoneyInput,
): boolean {
  return (
    money(input.total) > MONEY_EPS ||
    money(input.totalParts) > MONEY_EPS ||
    money(input.totalLabor) > MONEY_EPS ||
    money(input.miscExp) > MONEY_EPS ||
    money(input.shipping) > MONEY_EPS ||
    extractQuotedServicePrice(combinedText(input)) > MONEY_EPS
  );
}

/** Placeholder or sentence codes that should be remapped onto real products. */
export function isPlaceholderProductCode(partNumber: string | undefined): boolean {
  const raw = (partNumber ?? "").trim();
  if (!raw) return true;
  const code = normalizeProductCode(raw);
  if (!code || code.startsWith("IMPORTED")) return true;
  return /\s/.test(raw) || raw.length > 24;
}

export function workOrderLinesNeedRebuild(
  parts: Array<{ lineType?: string; partNumber?: string }> | undefined,
): boolean {
  const priced = (parts ?? []).filter((part) => part.lineType !== "note");
  if (priced.length === 0) return true;
  return priced.some((part) => isPlaceholderProductCode(part.partNumber));
}

export function workOrderLinesNeedProductLink(
  parts:
    | Array<{ lineType?: string; partNumber?: string; productRef?: unknown }>
    | undefined,
): boolean {
  return (parts ?? []).some((part) => {
    if (part.lineType === "note") return false;
    if (part.productRef) return false;
    return !isPlaceholderProductCode(part.partNumber);
  });
}

/**
 * Map a legacy SQL work-order header (totals + free-text) onto the current
 * products/parts model. SQL `total` is the source of truth when present.
 */
export function mapLegacyWorkOrderItems(
  input: LegacyWorkOrderMoneyInput,
  catalog: LegacyCatalogProduct[] = [],
): LegacyMappedWorkOrderMoney {
  const laborHours = Math.max(0, money(input.laborHours));
  const sqlParts = money(input.totalParts);
  const sqlLabor = money(input.totalLabor);
  const miscExp = money(input.miscExp);
  const shipping = money(input.shipping);
  let total = money(input.total);
  const componentTotal = roundMoney(sqlParts + sqlLabor + miscExp + shipping);
  if (total <= MONEY_EPS && componentTotal > MONEY_EPS) {
    total = componentTotal;
  }
  // A written quote is the billable total only when SQL stored no money.
  // Do not override a positive SQL total.
  if (total <= MONEY_EPS && componentTotal <= MONEY_EPS) {
    const quoted = extractQuotedServicePrice(combinedText(input));
    if (quoted > MONEY_EPS) total = quoted;
  }

  if (total <= MONEY_EPS) {
    return {
      parts: [],
      laborHours,
      laborOverridden: false,
      totalParts: 0,
      totalLabor: 0,
      totalAgreements: 0,
      miscExp: 0,
      shipping: 0,
      subtotal: 0,
      total: 0,
    };
  }

  const core = Math.max(0, roundMoney(total - miscExp - shipping));
  const text = combinedText(input);
  const catalogMatches = matchCatalogProducts(text, catalog, core);
  const detections = mergeDetections(catalogMatches, matchKeywordItems(text));
  const partItems = detections.filter((item) => item.kind === "part");
  const laborItems = detections.filter((item) => item.kind === "labor");

  let partBudget = 0;
  let laborBudget = 0;
  const hasExplicitSplit = sqlParts > MONEY_EPS || sqlLabor > MONEY_EPS;
  if (hasExplicitSplit) {
    partBudget = sqlParts;
    laborBudget = sqlLabor;
    const leftover = roundMoney(core - partBudget - laborBudget);
    if (leftover > MONEY_EPS) {
      if (laborBudget <= MONEY_EPS) laborBudget = leftover;
      else if (partBudget <= MONEY_EPS) partBudget = leftover;
      else laborBudget = roundMoney(laborBudget + leftover);
    }
  } else {
    const quotedService = extractQuotedServicePrice(input.descPerform ?? "");
    const catalogPartCost = roundMoney(
      partItems
        .filter((item) => item.listPrice > MONEY_EPS)
        .reduce((sum, item) => sum + item.listPrice, 0),
    );
    if (quotedService > MONEY_EPS && quotedService < core - MONEY_EPS) {
      laborBudget = quotedService;
      partBudget = roundMoney(core - quotedService);
    } else if (catalogPartCost > MONEY_EPS && catalogPartCost < core - MONEY_EPS) {
      partBudget = catalogPartCost;
      laborBudget = roundMoney(core - catalogPartCost);
    } else if (laborItems.length > 0 && partItems.every((item) => item.addon)) {
      laborBudget = core;
      partBudget = 0;
    } else if (partItems.length > 0 && laborItems.length === 0) {
      const onlyAddons = partItems.every((item) => item.addon);
      if (onlyAddons) {
        laborBudget = core;
        partBudget = 0;
      } else {
        partBudget = core;
        laborBudget = 0;
      }
    } else {
      laborBudget = core;
      partBudget = 0;
    }
  }

  const parts: NormalizedTicketPart[] = [
    ...allocateKind(partItems, partBudget, "part", "PARTS", "PARTS"),
    ...allocateKind(
      laborItems,
      laborBudget,
      "labor",
      "SERVICE",
      laborItems[0]?.partNumber || "SERVICE",
    ),
  ];

  const normalized = normalizeParts(parts);
  const totals = computeTicketTotals({
    parts: normalized,
    laborHours,
    laborOverridden: false,
    miscExp,
    shipping,
  });

  if (Math.abs(totals.total - total) > MONEY_EPS) {
    const adjustable = [...normalized]
      .reverse()
      .find((part) => part.lineType !== "note");
    if (adjustable) {
      const delta = roundMoney(total - totals.total);
      adjustable.amount = roundMoney(adjustable.amount + delta);
      adjustable.unitPrice = adjustable.quantity
        ? roundMoney(adjustable.amount / adjustable.quantity)
        : adjustable.amount;
      adjustable.priceOverridden = true;
    }
  }

  const reconciled = computeTicketTotals({
    parts: normalized,
    laborHours,
    laborOverridden: false,
    miscExp,
    shipping,
  });

  return {
    parts: normalized,
    laborHours,
    laborOverridden: false,
    ...reconciled,
  };
}

export function partsForMongo(parts: NormalizedTicketPart[]) {
  return parts.map((part) => ({
    productRef:
      part.productRef && Types.ObjectId.isValid(part.productRef)
        ? new Types.ObjectId(part.productRef)
        : null,
    contractTemplateRef:
      part.contractTemplateRef && Types.ObjectId.isValid(part.contractTemplateRef)
        ? new Types.ObjectId(part.contractTemplateRef)
        : null,
    enrolledContractRef:
      part.enrolledContractRef && Types.ObjectId.isValid(part.enrolledContractRef)
        ? new Types.ObjectId(part.enrolledContractRef)
        : null,
    lineType: part.lineType,
    kind: part.kind,
    partNumber: part.partNumber,
    description: part.description,
    quantity: part.quantity,
    unitPrice: part.unitPrice,
    listPrice: part.listPrice,
    priceOverridden: part.priceOverridden,
    amount: part.amount,
  }));
}

export function workOrderMoneyFieldsFromMapped(mapped: LegacyMappedWorkOrderMoney) {
  return {
    parts: partsForMongo(mapped.parts),
    laborHours: mapped.laborHours,
    laborOverridden: mapped.laborOverridden,
    totalParts: mapped.totalParts,
    totalLabor: mapped.totalLabor,
    totalAgreements: mapped.totalAgreements,
    miscExp: mapped.miscExp,
    shipping: mapped.shipping,
    subtotal: mapped.subtotal,
    total: mapped.total,
  };
}

function findCatalogByCode(
  catalog: LegacyCatalogProduct[],
  code: string,
): LegacyCatalogProduct | undefined {
  const needle = normalizeProductCode(code);
  if (!needle) return undefined;
  return catalog.find((product) => {
    const productCode = catalogCode(product);
    const partNumber = normalizeProductCode(product.partNumber || "");
    return productCode === needle || partNumber === needle;
  });
}

/** Attach catalog refs by code without changing a line's billed amount. */
export function linkCatalogProductRefs(
  parts: NormalizedTicketPart[],
  catalog: LegacyCatalogProduct[],
): boolean {
  let changed = false;
  for (const part of parts) {
    if (part.lineType === "note" || part.productRef) continue;
    const product = findCatalogByCode(catalog, part.partNumber);
    if (!product) continue;
    part.productRef = product._id;
    const listPrice = catalogPrice(product);
    if (listPrice > MONEY_EPS && Math.abs(listPrice - part.unitPrice) > MONEY_EPS) {
      part.listPrice = listPrice;
      part.priceOverridden = true;
    }
    changed = true;
  }
  return changed;
}

export type LegacyProductDraft = {
  partNumber: string;
  name: string;
  kind: "part" | "labor";
  listPrice: number;
};

export type LegacyProductWriter = {
  findByCodes: (code: string) => Promise<(LegacyCatalogProduct & { active?: boolean }) | null>;
  save: (
    product: LegacyCatalogProduct & { active?: boolean },
  ) => Promise<LegacyCatalogProduct>;
  create: (draft: LegacyProductDraft) => Promise<LegacyCatalogProduct>;
};

function draftsFromParts(
  parts: Array<
    Pick<
      NormalizedTicketPart,
      "lineType" | "partNumber" | "description" | "kind" | "listPrice" | "unitPrice" | "amount"
    >
  >,
  catalog: LegacyCatalogProduct[],
): LegacyProductDraft[] {
  const drafts: LegacyProductDraft[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.lineType === "note") continue;
    if (money(part.amount) <= MONEY_EPS && money(part.unitPrice) <= MONEY_EPS) continue;
    const code = normalizeProductCode(part.partNumber || "");
    if (!code || code.startsWith("IMPORTED") || seen.has(code)) continue;
    if (findCatalogByCode(catalog, code)) continue;
    seen.add(code);
    const listPrice = money(part.listPrice) > MONEY_EPS ? money(part.listPrice) : money(part.unitPrice);
    drafts.push({
      partNumber: code,
      name: (part.description || code).trim().toUpperCase() || code,
      kind: part.kind === "labor" ? "labor" : "part",
      listPrice,
    });
  }
  return drafts;
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: number }).code === 11000);
}

function catalogFromProduct(product: {
  _id: unknown;
  productCode?: string;
  partNumber?: string;
  name?: string;
  kind?: string;
  listPrice?: number;
  unitPrice?: number;
  active?: boolean;
}): LegacyCatalogProduct {
  return {
    _id: String(product._id),
    productCode: product.productCode,
    partNumber: product.partNumber,
    name: product.name,
    kind: product.kind,
    listPrice: product.listPrice,
    unitPrice: product.unitPrice,
    active: product.active,
  };
}

/** Create missing canonical products. First list price wins; later lines override price. */
export async function ensureLegacyCatalogProducts(
  writer: LegacyProductWriter,
  parts: Array<
    Pick<
      NormalizedTicketPart,
      "lineType" | "partNumber" | "description" | "kind" | "listPrice" | "unitPrice" | "amount"
    >
  >,
  catalog: LegacyCatalogProduct[],
): Promise<void> {
  const drafts = draftsFromParts(parts, catalog);
  for (const draft of drafts) {
    if (findCatalogByCode(catalog, draft.partNumber)) continue;
    let product = await writer.findByCodes(draft.partNumber);
    if (product?.active === false) {
      product = await writer.save({ ...product, active: true });
    }
    if (!product) {
      product = await writer.create(draft);
    }
    if (product && !findCatalogByCode(catalog, product.partNumber || draft.partNumber)) {
      catalog.push(product);
    }
  }
}

export function mongooseLegacyProductWriter(ProductModel: Model<IProduct>): LegacyProductWriter {
  async function findByCodes(code: string) {
    const doc = await ProductModel.findOne({
      $or: [{ partNumber: code }, { productCode: code }],
    }).select("_id productCode partNumber name kind listPrice unitPrice active");
    return doc ? catalogFromProduct(doc) : null;
  }

  return {
    findByCodes,
    async save(product) {
      await ProductModel.updateOne({ _id: product._id }, { $set: { active: true } });
      return { ...product, active: true };
    },
    async create(draft) {
      try {
        const doc = await ProductModel.create({
          partNumber: draft.partNumber,
          productCode: draft.partNumber,
          productNumber: draft.partNumber,
          name: draft.name,
          kind: draft.kind,
          listPrice: draft.listPrice,
          unitPrice: draft.listPrice,
          active: true,
        });
        return catalogFromProduct(doc);
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        const existing = await findByCodes(draft.partNumber);
        if (!existing) throw err;
        if (existing.active === false) {
          await ProductModel.updateOne({ _id: existing._id }, { $set: { active: true } });
          return { ...existing, active: true };
        }
        return existing;
      }
    },
  };
}

/**
 * Map, create any missing product codes, then map again so new products link.
 * Mutates `catalog` with products created during this call.
 */
export async function resolveLegacyWorkOrderMoney(
  input: LegacyWorkOrderMoneyInput,
  catalog: LegacyCatalogProduct[],
  writer?: LegacyProductWriter | null,
): Promise<LegacyMappedWorkOrderMoney> {
  if (writer) {
    const preview = mapLegacyWorkOrderItems(input, catalog);
    if (preview.total > MONEY_EPS) {
      await ensureLegacyCatalogProducts(writer, preview.parts, catalog);
    }
  }
  const mapped = mapLegacyWorkOrderItems(input, catalog);
  linkCatalogProductRefs(mapped.parts, catalog);
  return mapped;
}

export function mappedWorkOrderMoneyFields(
  input: LegacyWorkOrderMoneyInput,
  catalog: LegacyCatalogProduct[] = [],
) {
  const mapped = mapLegacyWorkOrderItems(input, catalog);
  linkCatalogProductRefs(mapped.parts, catalog);
  return workOrderMoneyFieldsFromMapped(mapped);
}
