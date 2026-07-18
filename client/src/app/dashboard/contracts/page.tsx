"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ServiceContractsTable from "@/components/contracts/ServiceContractsTable";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getContracts,
  getContractTemplates,
  ContractListItem,
  ContractStanding,
  ContractTemplateItem,
  ApiError,
} from "@/lib/api";
import {
  ContractTypeFilter,
  buildContractTypeFilterTabs,
  formatContractCatalogLabel,
  matchesContractTypeFilter,
} from "@/lib/contractTypes";

type StandingFilter = ContractStanding | "all";

const STANDING_TABS: { value: StandingFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "due_soon", label: "Due Soon" },
  { value: "expired", label: "Expired" },
];

function matchesSearch(contract: ContractListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const customerName = contract.customer
    ? `${contract.customer.first} ${contract.customer.last}`.toLowerCase()
    : "";
  const description = contract.description.toLowerCase();
  const typeLabel = formatContractCatalogLabel(contract).toLowerCase();

  return (
    customerName.includes(q) || description.includes(q) || typeLabel.includes(q)
  );
}

function ContractsContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [templates, setTemplates] = useState<ContractTemplateItem[]>([]);
  const [search, setSearch] = useState("");
  const [standingFilter, setStandingFilter] = useState<StandingFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ContractTypeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const typeTabs = useMemo(
    () => buildContractTypeFilterTabs(templates),
    [templates],
  );

  const filteredContracts = useMemo(
    () =>
      contracts.filter(
        (c) =>
          matchesContractTypeFilter(c, typeFilter) && matchesSearch(c, search),
      ),
    [contracts, search, typeFilter],
  );

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!token || user?.role === "customer") return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);

    Promise.all([
      getContracts(token, standingFilter),
      getContractTemplates(token),
    ])
      .then(([{ contracts: list }, { templates: catalog }]) => {
        setContracts(list);
        setTemplates(catalog);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load contracts.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, user, standingFilter]);

  if (!user || user.role === "customer") return null;

  if (loading)
    return (
      <div className="text-sm text-neutral-500 py-6">Loading contracts…</div>
    );
  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">
            Service Contracts
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {search.trim() || typeFilter !== "all"
              ? `${filteredContracts.length} of ${contracts.length} contracts`
              : `${contracts.length} total`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer or description…"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs font-medium uppercase tracking-wide text-neutral-400">
            Standing
          </span>
          {STANDING_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStandingFilter(tab.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                standingFilter === tab.value
                  ? "bg-brand-orange text-white"
                  : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs font-medium uppercase tracking-wide text-neutral-400">
            Type
          </span>
          {typeTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTypeFilter(tab.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === tab.value
                  ? "bg-brand-dark text-white"
                  : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <ServiceContractsTable
        contracts={filteredContracts}
        showCustomer
        showAddress
        returnTo="/dashboard/contracts"
        emptyMessage={
          search.trim() || typeFilter !== "all"
            ? "No contracts match your filters."
            : "No contracts yet."
        }
      />
    </div>
  );
}

export default function ContractsPage() {
  return (
    <AuthGuard>
      <ContractsContent />
    </AuthGuard>
  );
}
