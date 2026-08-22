export function buildProductAltCode(productCode: string): string {
  const code = productCode.trim();
  if (!code) return "";
  if (code.toUpperCase().startsWith("GMOF")) return code;
  return `GMOF${code}`;
}
