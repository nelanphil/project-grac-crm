import { normalizeProductCode } from "./productCodes";

/** Catalog / line-item codes for the Annual Service Contract product. */
export const ASC_PRODUCT_CODES = new Set(["ASC", "ACS"]);

/**
 * Word-boundary match for ASC product mentions in ticket or invoice text.
 * Broader than a raw "ASC" substring so names like "Cascade" do not match.
 */
export const ASC_PRODUCT_TEXT =
  /\b(?:asc|acs|annual\s+service(?:\s+contract)?)\b/i;

export function isAscProductCode(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  return ASC_PRODUCT_CODES.has(normalizeProductCode(code));
}

export function textMentionsAscProduct(
  text: string | null | undefined,
): boolean {
  return ASC_PRODUCT_TEXT.test(text ?? "");
}

export type AscLineCandidate = {
  lineType?: string | null;
  partNumber?: string | null;
  productCode?: string | null;
  description?: string | null;
  productRef?: { toString(): string } | string | null;
};

export function lineContainsAscProduct(
  line: AscLineCandidate,
  ascProductIds?: Set<string>,
): boolean {
  if (line.lineType === "note") return false;
  if (isAscProductCode(line.partNumber) || isAscProductCode(line.productCode)) {
    return true;
  }
  if (line.productRef && ascProductIds?.has(String(line.productRef))) {
    return true;
  }
  return (
    textMentionsAscProduct(line.description) ||
    textMentionsAscProduct(line.partNumber)
  );
}

export function workOrderContainsAscProduct(
  wo: {
    parts?: AscLineCandidate[] | null;
    descPerform?: string | null;
    descPerformed?: string | null;
  },
  ascProductIds?: Set<string>,
): boolean {
  const parts = wo.parts ?? [];
  if (parts.some((part) => lineContainsAscProduct(part, ascProductIds))) {
    return true;
  }
  return (
    textMentionsAscProduct(wo.descPerform) ||
    textMentionsAscProduct(wo.descPerformed)
  );
}

export function invoiceContainsAscProduct(
  invoice: {
    lineItems?: Array<{
      description?: string | null;
      productCode?: string | null;
    }> | null;
  },
): boolean {
  return (invoice.lineItems ?? []).some(
    (item) =>
      isAscProductCode(item.productCode) ||
      textMentionsAscProduct(item.description),
  );
}
