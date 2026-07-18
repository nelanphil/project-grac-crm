"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { ContractListItem } from "@/lib/api";
import {
  STANDING_LABELS,
  STANDING_STYLES,
  formatDateOnly,
} from "@/lib/contractDates";
import {
  formatContractCatalogLabel,
  getContractTypeStyle,
} from "@/lib/contractTypes";
import { formatCustomerName } from "@/lib/formatName";
import LucideIconByName from "@/components/icons/LucideIconByName";
import { formatAddressLabel } from "@/components/customers/CustomerAddressesPanel";
import { ContractEquipmentSummary } from "@/lib/api";

export function formatEquipmentLabel(
  equipment: ContractEquipmentSummary | null | undefined
): string {
  if (!equipment) return "—";
  const model = equipment.generatorModel?.trim();
  const serial = equipment.serial?.trim();
  if (model && serial) return `${model} · ${serial}`;
  return model || serial || equipment.atsSerial?.trim() || "Equipment";
}

interface ContractRowProps {
  contract: ContractListItem;
  showCustomer?: boolean;
  showAddress?: boolean;
  canEdit: boolean;
  returnTo: string;
}

function StandingBadge({ contract }: { contract: ContractListItem }) {
  const standing = contract.standing ?? "expired";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STANDING_STYLES[standing]}`}
    >
      {STANDING_LABELS[standing]}
    </span>
  );
}

function TypeBadge({ contract }: { contract: ContractListItem }) {
  const label = formatContractCatalogLabel(contract);
  const icon = contract.template?.badgeIcon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getContractTypeStyle(contract.template?.slug ?? contract.contractType)}`}
    >
      {icon ? <LucideIconByName name={icon} className="h-3 w-3" size={12} /> : null}
      {label}
    </span>
  );
}

function ContractRow({
  contract,
  showCustomer,
  showAddress,
  canEdit,
  returnTo,
}: ContractRowProps) {
  const editHref = `/dashboard/contracts/${contract._id}/edit?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <tr className="hover:bg-neutral-50 transition-colors">
      {showCustomer && (
        <td className="px-6 py-4 whitespace-nowrap">
          {contract.customer ? (
            <Link
              href={`/dashboard/customers/${contract.customer._id}`}
              className="font-medium text-brand-dark hover:text-brand-orange transition-colors"
            >
              {formatCustomerName(contract.customer.first, contract.customer.last)}
            </Link>
          ) : (
            <span className="text-neutral-400">Unknown customer</span>
          )}
        </td>
      )}
      {showAddress && (
        <>
          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
            {formatAddressLabel(contract.address)}
          </td>
          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
            {formatEquipmentLabel(contract.equipment)}
          </td>
        </>
      )}
      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
        {formatDateOnly(contract.originalContractDate)}
      </td>
      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
        {formatDateOnly(contract.renewalDueDate)}
      </td>
      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
        {contract.durationMonths ? `${contract.durationMonths} mo` : "—"}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <TypeBadge contract={contract} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <StandingBadge contract={contract} />
      </td>
      <td className="px-6 py-4 text-neutral-600">{contract.description || "—"}</td>
      {canEdit && (
        <td className="px-6 py-4 whitespace-nowrap text-right">
          <Link
            href={editHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-orange hover:underline"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Link>
        </td>
      )}
    </tr>
  );
}

interface ServiceContractsTableProps {
  contracts: ContractListItem[];
  showCustomer?: boolean;
  showAddress?: boolean;
  returnTo?: string;
  emptyMessage?: string;
}

export default function ServiceContractsTable({
  contracts,
  showCustomer = false,
  showAddress = false,
  returnTo = "/dashboard/contracts",
  emptyMessage = "No contracts yet.",
}: ServiceContractsTableProps) {
  const canEdit = useAuthStore((s) => s.hasPermission("contracts:write"));
  const colCount =
    (showCustomer ? 7 : 6) + (showAddress ? 2 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-100 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              {showCustomer && (
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Customer
                </th>
              )}
              {showAddress && (
                <>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Address
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Equipment
                  </th>
                </>
              )}
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Original Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Renewal Due
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Duration
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Standing
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Description
              </th>
              {canEdit && (
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-12 text-center text-neutral-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              contracts.map((contract) => (
                <ContractRow
                  key={contract._id}
                  contract={contract}
                  showCustomer={showCustomer}
                  showAddress={showAddress}
                  canEdit={canEdit}
                  returnTo={returnTo}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
