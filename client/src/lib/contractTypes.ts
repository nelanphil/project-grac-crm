import type { ContractListItem, ContractTemplateItem } from "@/lib/api";

export type ContractTypeFilter = "all" | "unset" | string;

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  service: "Service",
};

export const CONTRACT_TYPE_STYLES: Record<string, string> = {
  service: "border-green-200 bg-green-50 text-green-700",
  unset: "border-neutral-200 bg-neutral-50 text-neutral-500",
};

const FALLBACK_TYPE_STYLE = "border-sky-200 bg-sky-50 text-sky-700";

export function formatContractType(contractType: string | null | undefined): string {
  if (!contractType) return "Unset";
  return CONTRACT_TYPE_LABELS[contractType] ?? contractType;
}

/** Prefer catalog template label when present. */
export function formatContractCatalogLabel(contract: ContractListItem): string {
  if (contract.template?.label) return contract.template.label;
  return formatContractType(contract.contractType);
}

export function getContractTypeStyle(contractType: string | null | undefined): string {
  if (!contractType) return CONTRACT_TYPE_STYLES.unset;
  return CONTRACT_TYPE_STYLES[contractType] ?? FALLBACK_TYPE_STYLE;
}

export function matchesContractTypeFilter(
  contract: ContractListItem,
  filter: ContractTypeFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unset") {
    return (
      !contract.templateId &&
      (contract.contractType == null || contract.contractType === "")
    );
  }
  if (contract.template?.slug === filter) return true;
  if (contract.templateId === filter) return true;
  return contract.contractType === filter;
}

export function buildContractTypeFilterTabs(
  templates: ContractTemplateItem[],
): { value: ContractTypeFilter; label: string }[] {
  const active = templates.filter((t) => !t.deletedAt);
  return [
    { value: "all", label: "All Types" },
    ...active.map((t) => ({ value: t.slug, label: t.label })),
    { value: "unset", label: "Unset" },
  ];
}
