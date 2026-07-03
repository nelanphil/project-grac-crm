"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { ContractListItem } from "@/lib/api";

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

interface ContractRowProps {
  contract: ContractListItem;
  showCustomer?: boolean;
  canEdit: boolean;
  returnTo: string;
}

function ContractRow({ contract, showCustomer, canEdit, returnTo }: ContractRowProps) {
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
              {contract.customer.first} {contract.customer.last}
            </Link>
          ) : (
            <span className="text-neutral-400">Unknown customer</span>
          )}
        </td>
      )}
      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
        {formatDate(contract.contractDate)}
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
  returnTo?: string;
  emptyMessage?: string;
}

export default function ServiceContractsTable({
  contracts,
  showCustomer = false,
  returnTo = "/dashboard/contracts",
  emptyMessage = "No service contracts yet.",
}: ServiceContractsTableProps) {
  const canEdit = useAuthStore((s) => s.hasPermission("contracts:write"));
  const colCount = (showCustomer ? 3 : 2) + (canEdit ? 1 : 0);

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
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Contract Date
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
