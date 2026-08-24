export const DISCOUNT_MODES = ["percent", "amount"] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

export interface KindDiscount {
  enabled: boolean;
  mode: DiscountMode;
  value: number;
}

export interface ProductDiscounts {
  parts: KindDiscount;
  labor: KindDiscount;
}

export interface ContractProductDiscountOverride extends ProductDiscounts {
  override: boolean;
}

export interface TicketContractDiscount extends ProductDiscounts {
  label: string;
}

export const DEFAULT_KIND_DISCOUNT: KindDiscount = {
  enabled: false,
  mode: "percent",
  value: 0,
};

export const DEFAULT_PRODUCT_DISCOUNTS: ProductDiscounts = {
  parts: { ...DEFAULT_KIND_DISCOUNT },
  labor: { ...DEFAULT_KIND_DISCOUNT },
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function normalizeKindDiscount(
  raw?: Partial<KindDiscount> | null,
): KindDiscount {
  const mode: DiscountMode = raw?.mode === "amount" ? "amount" : "percent";
  let value = Number(raw?.value);
  if (!Number.isFinite(value) || value < 0) value = 0;
  if (mode === "percent" && value > 100) value = 100;
  return {
    enabled: Boolean(raw?.enabled),
    mode,
    value: roundMoney(value),
  };
}

export function normalizeProductDiscounts(
  raw?: Partial<ProductDiscounts> | null,
): ProductDiscounts {
  return {
    parts: normalizeKindDiscount(raw?.parts),
    labor: normalizeKindDiscount(raw?.labor),
  };
}

export function resolveEffectiveDiscounts(opts: {
  template?: Partial<ProductDiscounts> | null;
  contract?: Partial<ContractProductDiscountOverride> | null;
}): ProductDiscounts {
  const template = normalizeProductDiscounts(opts.template);
  if (!opts.contract?.override) return template;
  return normalizeProductDiscounts(opts.contract);
}

export function applyKindDiscount(
  amount: number,
  rule: KindDiscount,
): number {
  const base = roundMoney(Math.max(0, amount));
  if (!rule.enabled || rule.value <= 0) return base;
  if (rule.mode === "percent") {
    return roundMoney(Math.max(0, base * (1 - rule.value / 100)));
  }
  return roundMoney(Math.max(0, base - rule.value));
}

export function discountedUnitPrice(
  listPrice: number,
  kind: "part" | "labor",
  discounts: ProductDiscounts,
): number {
  const rule = kind === "labor" ? discounts.labor : discounts.parts;
  return applyKindDiscount(listPrice, rule);
}

export function discountedLaborTotal(
  laborTotal: number,
  discounts: ProductDiscounts | null | undefined,
): number {
  if (!discounts) return roundMoney(Math.max(0, laborTotal));
  return applyKindDiscount(laborTotal, discounts.labor);
}

export function hasAnyDiscount(discounts: ProductDiscounts): boolean {
  return (
    (discounts.parts.enabled && discounts.parts.value > 0) ||
    (discounts.labor.enabled && discounts.labor.value > 0)
  );
}

export function formatKindDiscount(rule: KindDiscount): string | null {
  if (!rule.enabled || rule.value <= 0) return null;
  if (rule.mode === "percent") return `${rule.value}% off`;
  return `$${rule.value.toFixed(2)} off`;
}

export function formatDiscountSummary(
  discounts: ProductDiscounts,
  label?: string,
): string | null {
  const parts: string[] = [];
  const partsRule = formatKindDiscount(discounts.parts);
  const laborRule = formatKindDiscount(discounts.labor);
  if (partsRule) parts.push(`${partsRule} parts`);
  if (laborRule) parts.push(`${laborRule} labor`);
  if (parts.length === 0) return null;
  if (label === "") return parts.join(", ");
  const prefix = label?.trim() ? `${label.trim()}: ` : "Service contract: ";
  return `${prefix}${parts.join(", ")}`;
}

function refId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as { _id?: unknown; toString?: () => string };
    if (obj._id) return String(obj._id);
    if (typeof obj.toString === "function") {
      const s = obj.toString();
      if (s && s !== "[object Object]") return s;
    }
  }
  return String(value);
}

export function matchContractForTicket<
  T extends {
    inGoodStanding?: boolean;
    addressRef?: string | null;
    equipmentRef?: string | null;
    contractDate?: string | Date | null;
  },
>(
  contracts: T[],
  opts: { addressRef?: string | null; equipmentRef?: string | null },
): T | null {
  const standing = contracts.filter((c) => c.inGoodStanding);
  if (standing.length === 0) return null;

  const equipmentId = refId(opts.equipmentRef);
  const addressId = refId(opts.addressRef);

  const byEquipment = equipmentId
    ? standing.filter((c) => refId(c.equipmentRef) === equipmentId)
    : [];
  if (byEquipment.length) return pickLatest(byEquipment);

  const byAddress = addressId
    ? standing.filter(
        (c) => refId(c.addressRef) === addressId && !refId(c.equipmentRef),
      )
    : [];
  if (byAddress.length) return pickLatest(byAddress);

  const customerWide = standing.filter(
    (c) => !refId(c.addressRef) && !refId(c.equipmentRef),
  );
  if (customerWide.length) return pickLatest(customerWide);

  return pickLatest(standing);
}

function pickLatest<T extends { contractDate?: string | Date | null }>(
  list: T[],
): T {
  return [...list].sort((a, b) => {
    const da = a.contractDate ? new Date(a.contractDate).getTime() : 0;
    const db = b.contractDate ? new Date(b.contractDate).getTime() : 0;
    return db - da;
  })[0];
}

export function ticketSiteKey(opts: {
  customerId?: number | null;
  addressRef?: string | null;
  equipmentRef?: string | null;
}): string {
  return `${opts.customerId ?? ""}|${opts.addressRef ?? ""}|${opts.equipmentRef ?? ""}`;
}
