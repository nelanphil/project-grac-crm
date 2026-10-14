"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getCustomerAttention,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

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
  filteredContracts,
  addressFilter,
  onAddressFilterChange,
  onContractUpdated,
}: CustomerRecordCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = useAuthStore((s) => s.hasRole("admin", "super-admin"));
  const activeTab = parseTab(searchParams.get("tab"));
  const [visited, setVisited] = useState<Set<RecordTab>>(
    () => new Set<RecordTab>([activeTab]),
  );
  if (!visited.has(activeTab)) {
    const next = new Set(visited);
    next.add(activeTab);
    setVisited(next);
  }
  const [notesAlert, setNotesAlert] = useState(false);
  const [commsAlert, setCommsAlert] = useState(false);
  const notesHold = useRef(false);
  const notesRequest = useRef(0);

  const contacts = customer.contacts ?? [];
  const addresses = customer.addresses ?? [];
  const showNotesAlert = activeTab !== "notes" && notesAlert;
  const showCommsAlert = isAdmin && commsAlert;

  const loadAttention = useCallback(async () => {
    const request = notesRequest.current;
    try {
      const attention = await getCustomerAttention(token, customer._id);
      setCommsAlert(attention.unreadCommunications);
      if (request !== notesRequest.current) return;
      setNotesAlert(attention.unviewedNotes || notesHold.current);
    } catch {
      // A failed check leaves the dots as they were.
    }
  }, [token, customer._id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAttention();
  }, [loadAttention]);

  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "hidden") return;
      void loadAttention();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadAttention]);

  const handleUnviewedChange = useCallback((hasUnviewed: boolean) => {
    notesHold.current = hasUnviewed;
    notesRequest.current += 1;
    setNotesAlert(hasUnviewed);
  }, []);

  const tabs = useMemo(
    () => [
      { id: "contacts" as const, label: "Contacts", alert: false },
      { id: "address" as const, label: "Address", alert: false },
      {
        id: "notes" as const,
        label: "Notes",
        alert: showNotesAlert,
        alertLabel: "Notes, unviewed note",
      },
      { id: "contracts" as const, label: "Contracts", alert: false },
      {
        id: "communications" as const,
        label: "Communications",
        alert: showCommsAlert,
        alertLabel: "Communications, unread message",
      },
    ],
    [showNotesAlert, showCommsAlert],
  );

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
            aria-label={tab.alert ? tab.alertLabel : tab.label}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
              activeTab === tab.id
                ? "bg-brand-orange text-white"
                : "text-neutral-600 hover:bg-white"
            }`}
          >
            {tab.label}
            {tab.alert ? (
              <span
                className={`ml-1.5 inline-block h-2 w-2 rounded-full ${
                  activeTab === tab.id ? "bg-white" : "bg-brand-orange"
                }`}
                aria-hidden
              />
            ) : null}
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
            active={activeTab === "notes"}
            onUnviewedChange={handleUnviewedChange}
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
