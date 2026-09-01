export function uppercaseText(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeProductCode(productCode: string): string {
  return productCode.replace(/\s+/g, "").toUpperCase();
}

export function buildProductAltCode(productCode: string): string {
  const code = normalizeProductCode(productCode);
  if (!code) return "";
  if (code.startsWith("GMOF")) return code;
  return `GMOF${code}`;
}
