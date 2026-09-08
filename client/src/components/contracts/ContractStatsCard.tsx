"use client";

import { useMemo } from "react";
import { ScrollText } from "lucide-react";
import { ContractListItem, ContractStanding } from "@/lib/api";
import FilterStatsCards, {
  FilterStatItem,
} from "@/components/ui/FilterStatsCards";

type StandingFilter = ContractStanding | "all";

export default function ContractStatsCard({
  contracts,
  loading,
  selected,
  onSelect,
}: {
  contracts: ContractListItem[];
  loading?: boolean;
  selected: StandingFilter;
  onSelect: (filter: StandingFilter) => void;
}) {
  const contractStats = useMemo(() => {
    let active = 0;
    let dueSoon = 0;
    let expired = 0;
    for (const contract of contracts) {
      if (contract.standing === "active") active += 1;
      else if (contract.standing === "due_soon") dueSoon += 1;
      else if (contract.standing === "expired") expired += 1;
    }
    return { active, dueSoon, expired, total: contracts.length };
  }, [contracts]);

  const value = (n: number) => (loading ? "—" : String(n));

  const items: FilterStatItem<StandingFilter>[] = [
    { label: "Total", value: value(contractStats.total), tone: "neutral", filter: "all" },
    { label: "Active", value: value(contractStats.active), tone: "success", filter: "active" },
    { label: "Due soon", value: value(contractStats.dueSoon), tone: "warning", filter: "due_soon" },
    { label: "Expired", value: value(contractStats.expired), tone: "danger", filter: "expired" },
  ];

  return (
    <FilterStatsCards
      title="Contract stats"
      icon={ScrollText}
      items={items}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
