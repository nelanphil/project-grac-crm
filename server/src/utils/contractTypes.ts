export const ASC_PATTERN = /ASC|ACS/i;

export type ContractType = "service";

export function inferContractType(description: string): ContractType | null {
  return ASC_PATTERN.test(description) ? "service" : null;
}
