"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScrollText } from "lucide-react";
import ContactCard from "@/components/customers/ContactCard";
import CustomerAddressesPanel, {
  formatAddressLabel,
} from "@/components/customers/CustomerAddressesPanel";
import CustomerNotesPanel from "@/components/customers/CustomerNotesPanel";
import CustomerCommunicationsPanel from "@/components/customers/CustomerCommunicationsPanel";
import ServiceContractsTable from "@/components/contracts/ServiceContractsTable";
import {
  ContractListItem,
  CustomerAddress,
  CustomerDetail,
} from "@/lib/api";

export type RecordTab =
  | "contacts"
  | "address"
  | "notes"
  | "contracts"
  | "communications";

const TABS: RecordTab[] = [
  "contacts",
  "address",
  "notes",
  "contracts",
  "communications",
];

function parseTab(value: string | null): RecordTab {
  if (value && (TABS as string[]).includes(value)) {
    return value as RecordTab;
  }
  return "contacts";
}

function AddressFilterSelect({
  id,
  addresses,
  value,
  onChange,
}: {
  id: string;
  addresses: CustomerAddress[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <label htmlFor={id} className="text-sm font-medium text-neutral-600">
        Filter by address
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange sm:w-auto sm:py-1.5"
      >
        <option value="all">All addresses</option>
        {addresses.map((addr) => (
          <option key={addr._id} value={addr._id}>
            {addr.label || formatAddressLabel(addr)}
          </option>
        ))}
      </select>
    </div>
  );
}

type CustomerRecordCardProps = {
  customer: CustomerDetail;
  token: string;
  userId: string;
  canWrite: boolean;
  onCustomerChange: (customer: CustomerDetail) => void;
  contracts: ContractListItem[];
  filteredContracts: ContractListItem[];
  addressFilter: string;
  onAddressFilterChange: (value: string) => void;
  onContractUpdated: (contract: ContractListItem) => void;
};

export default function CustomerRecordCard({
  customer,
  token,
  userId,
  canWrite,
  onCustomerChange,
  contracts,
  filteredContracts,
  addressFilter,
  onAddressFilterChange,
  onContractUpdated,
}: CustomerRecordCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));
  const [visited, setVisited] = useState<Set<RecordTab>>(
    () => new Set<RecordTab>([activeTab]),
  );

  const contacts = customer.contacts ?? [];
  const addresses = customer.addresses ?? [];

  const tabs = useMemo(
    () => [
      {
        id: "contacts" as const,
        label: `Contacts${contacts.length > 0 ? ` (${contacts.length})` : ""}`,
      },
      {
        id: "address" as const,
        label: `Address${addresses.length > 0 ? ` (${addresses.length})` : ""}`,
      },
      { id: "notes" as const, label: "Notes" },
      {
        id: "contracts" as const,
        label: `Contracts${contracts.length > 0 ? ` (${contracts.length})` : ""}`,
      },
      { id: "communications" as const, label: "Communications" },
    ],
    [contacts.length, addresses.length, contracts.length],
  );

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  function setTab(id: RecordTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    const query = params.toString();
    router.replace(
      query
        ? `/dashboard/customers/detail?${query}`
        : "/dashboard/customers/detail",
      { scroll: false },
    );
  }

  const showPane = (id: RecordTab) =>
    activeTab === id || visited.has(id);

  return (
    <section
      id="customer-record"
      className="scroll-mt-28 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6 lg:scroll-mt-6"
    >
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
              activeTab === tab.id
                ? "bg-brand-orange text-white"
                : "text-neutral-600 hover:bg-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showPane("contacts") ? (
        <div className={activeTab === "contacts" ? undefined : "hidden"}>
          <ContactCard
            customer={customer}
            token={token}
            canWrite={canWrite}
            onCustomerChange={onCustomerChange}
          />
        </div>
      ) : null}

      {showPane("address") ? (
        <div className={activeTab === "address" ? undefined : "hidden"}>
          <CustomerAddressesPanel
            customerId={customer._id}
            token={token}
            addresses={addresses}
            canWrite={canWrite}
            onAddressesChange={(next) =>
              onCustomerChange({ ...customer, addresses: next })
            }
          />
        </div>
      ) : null}

      {showPane("notes") ? (
        <div className={activeTab === "notes" ? undefined : "hidden"}>
          <CustomerNotesPanel
            token={token}
            customerId={customer._id}
            userId={userId}
            enabled
            newNoteInputId="customerRecordNewNote"
          />
        </div>
      ) : null}

      {showPane("contracts") ? (
        <div
          className={`space-y-4 ${activeTab === "contracts" ? "" : "hidden"}`}
        >
          {addresses.length > 1 ? (
            <AddressFilterSelect
              id="record-address-filter"
              addresses={addresses}
              value={addressFilter}
              onChange={onAddressFilterChange}
            />
          ) : null}
          {filteredContracts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 py-12 text-center">
              <ScrollText className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">
                No contracts
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Contracts for this customer will appear here.
              </p>
            </div>
          ) : (
            <ServiceContractsTable
              contracts={filteredContracts}
              returnTo={`/dashboard/customers/detail?id=${customer._id}`}
              onUpdated={onContractUpdated}
            />
          )}
        </div>
      ) : null}

      {showPane("communications") ? (
        <div className={activeTab === "communications" ? undefined : "hidden"}>
          <CustomerCommunicationsPanel
            customerId={customer._id}
            contacts={contacts}
            token={token}
          />
        </div>
      ) : null}
    </section>
  );
}
