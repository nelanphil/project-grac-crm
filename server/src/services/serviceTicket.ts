import { Model } from "mongoose";
import {
  discountedLaborTotal,
  ProductDiscounts,
} from "../utils/productDiscounts";
import {
  computeTaxAmount,
  normalizeTaxRatePercent,
} from "./taxSettings";

export const LABOR_INCLUDED_MINUTES = 30;
export const LABOR_BLOCK_MINUTES = 30;
export const LABOR_BLOCK_RATE_DOLLARS = 75;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function defaultLaborTotal(laborHours: number): number {
  const minutes = Math.max(0, Number(laborHours) || 0) * 60;
  const extra = Math.max(0, minutes - LABOR_INCLUDED_MINUTES);
  if (extra <= 0) return 0;
  return Math.ceil(extra / LABOR_BLOCK_MINUTES) * LABOR_BLOCK_RATE_DOLLARS;
}

export type TicketLineType = "product" | "note" | "agreement";
export type TicketProductKind = "part" | "labor" | "equipment";

export interface TicketPartInput {
  productRef?: string | null;
  contractTemplateRef?: string | null;
  enrolledContractRef?: string | null;
  lineType?: TicketLineType | string;
  kind?: TicketProductKind | string;
  partNumber?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  listPrice?: number;
  priceOverridden?: boolean;
  amount?: number;
}

export interface NormalizedTicketPart {
  productRef: string | null;
  contractTemplateRef: string | null;
  enrolledContractRef: string | null;
  lineType: TicketLineType;
  kind: TicketProductKind;
  partNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  priceOverridden: boolean;
  amount: number;
}

function lineTypeOf(value: string | undefined): TicketLineType {
  if (value === "note") return "note";
  if (value === "agreement") return "agreement";
  return "product";
}

function refOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function normalizeParts(
  parts: TicketPartInput[] | undefined,
): NormalizedTicketPart[] {
  if (!parts?.length) return [];
  return parts
    .map((part) => {
      const lineType = lineTypeOf(part.lineType);
      const kind: TicketProductKind =
        lineType === "product" && part.kind === "labor"
          ? "labor"
          : lineType === "product" && part.kind === "equipment"
            ? "equipment"
            : "part";
      if (lineType === "note") {
        return {
          productRef: null,
          contractTemplateRef: null,
          enrolledContractRef: null,
          lineType,
          kind: "part" as const,
          partNumber: "",
          description: (part.description ?? "").trim(),
          quantity: 0,
          unitPrice: 0,
          listPrice: 0,
          priceOverridden: false,
          amount: 0,
        };
      }
      const quantity = roundMoney(Number(part.quantity) || 0);
      const unitPrice = roundMoney(Number(part.unitPrice) || 0);
      const listPrice = roundMoney(
        Number(part.listPrice ?? part.unitPrice) || 0,
      );
      const amount =
        part.amount != null && Number.isFinite(Number(part.amount))
          ? roundMoney(Number(part.amount))
          : roundMoney(quantity * unitPrice);
      if (lineType === "agreement") {
        return {
          productRef: null,
          contractTemplateRef: refOrNull(part.contractTemplateRef),
          enrolledContractRef: refOrNull(part.enrolledContractRef),
          lineType,
          kind: "part" as const,
          partNumber: "",
          description: (part.description ?? "").trim(),
          quantity,
          unitPrice,
          listPrice,
          priceOverridden: Boolean(part.priceOverridden),
          amount,
        };
      }
      return {
        productRef: part.productRef?.trim() ? part.productRef.trim() : null,
        contractTemplateRef: null,
        enrolledContractRef: null,
        lineType,
        kind,
        partNumber: (part.partNumber ?? "").trim(),
        description: (part.description ?? "").trim(),
        quantity,
        unitPrice,
        listPrice,
        priceOverridden: Boolean(part.priceOverridden),
        amount,
      };
    })
    .filter((part) => {
      if (part.lineType === "note") return Boolean(part.description);
      if (part.lineType === "agreement") {
        return Boolean(part.contractTemplateRef || part.description);
      }
      return Boolean(part.partNumber || part.description);
    });
}

export function hasLaborProductLines(
  parts: Array<{ lineType?: string; kind?: string }>,
): boolean {
  return parts.some(
    (part) =>
      part.lineType !== "note" &&
      part.lineType !== "agreement" &&
      part.kind === "labor",
  );
}

export function computeTicketTotals(input: {
  parts: Array<{ amount: number; lineType?: string; kind?: string }>;
  laborHours: number;
  totalLabor?: number;
  laborOverridden?: boolean;
  miscExp?: number;
  shipping?: number;
  taxRate?: number;
  tax?: number;
  taxOverridden?: boolean;
  contractDiscount?: ProductDiscounts | null;
}): {
  totalParts: number;
  totalLabor: number;
  totalAgreements: number;
  miscExp: number;
  subtotal: number;
  shipping: number;
  taxRate: number;
  tax: number;
  taxOverridden: boolean;
  total: number;
} {
  const productLines = input.parts.filter((part) => part.lineType !== "note");
  const totalParts = roundMoney(
    productLines
      .filter((part) => part.lineType !== "agreement" && part.kind !== "labor")
      .reduce((sum, part) => sum + (Number(part.amount) || 0), 0),
  );
  const totalAgreements = roundMoney(
    productLines
      .filter((part) => part.lineType === "agreement")
      .reduce((sum, part) => sum + (Number(part.amount) || 0), 0),
  );
  const lineLabor = roundMoney(
    productLines
      .filter((part) => part.lineType !== "agreement" && part.kind === "labor")
      .reduce((sum, part) => sum + (Number(part.amount) || 0), 0),
  );
  const totalLabor = hasLaborProductLines(productLines)
    ? lineLabor
    : input.laborOverridden && input.totalLabor != null
      ? roundMoney(input.totalLabor)
      : discountedLaborTotal(
          defaultLaborTotal(input.laborHours),
          input.contractDiscount,
        );
  const miscExp = roundMoney(input.miscExp ?? 0);
  const shipping = roundMoney(input.shipping ?? 0);
  const subtotal = roundMoney(totalParts + totalLabor + totalAgreements + miscExp);
  const taxRate = normalizeTaxRatePercent(input.taxRate);
  const taxOverridden = Boolean(input.taxOverridden);
  const tax = taxOverridden
    ? roundMoney(input.tax ?? 0)
    : computeTaxAmount(subtotal, taxRate);
  const total = roundMoney(subtotal + shipping + tax);
  return {
    totalParts,
    totalLabor,
    totalAgreements,
    miscExp,
    subtotal,
    shipping,
    taxRate,
    tax,
    taxOverridden,
    total,
  };
}

export async function nextPrefixedNumber<T extends { number?: string | null }>(
  model: Model<T>,
  prefix: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const fullPrefix = `${prefix}-${year}-`;
  const latest = await model
    .findOne({ number: new RegExp(`^${fullPrefix}`) })
    .sort({ number: -1 })
    .select("number")
    .lean();

  let seq = 1;
  if (latest?.number) {
    const part = latest.number.slice(fullPrefix.length);
    const n = parseInt(part, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${fullPrefix}${String(seq).padStart(5, "0")}`;
}

export function displayTicketNumber(doc: {
  number?: string | null;
  legacyId?: number | null;
}): string {
  if (doc.number?.trim()) return doc.number.trim();
  if (doc.legacyId) return String(doc.legacyId);
  return "";
}
