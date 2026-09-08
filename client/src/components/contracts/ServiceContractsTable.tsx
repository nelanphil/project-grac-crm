"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  ContractEquipmentSummary,
  ContractListItem,
  renewContract,
} from "@/lib/api";
import {
  STANDING_LABELS,
  STANDING_STYLES,
  formatDateOnly,
} from "@/lib/contractDates";
import {
  formatContractCatalogLabel,
  getContractTypeStyle,
} from "@/lib/contractTypes";
import { formatCustomerRecordName } from "@/lib/formatName";
import LucideIconByName from "@/components/icons/LucideIconByName";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";

export function formatEquipmentLabel(
  equipment: ContractEquipmentSummary | null | undefined,
): string {
  if (!equipment) return "—";
  const model = equipment.generatorModel?.trim();
  const serial = equipment.serial?.trim();
  if (model && serial) return `${model} · ${serial}`;
  return model || serial || equipment.atsSerial?.trim() || "Equipment";
}

function todayInputDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface ContractRowProps {
  contract: ContractListItem;
  showCustomer?: boolean;
  canEdit: boolean;
  returnTo: string;
  onUpdated?: (contract: ContractListItem) => void;
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
      {icon ? (
        <LucideIconByName name={icon} size={12} className="h-3 w-3" />
      ) : null}
      {label}
    </span>
  );
}

function ContractActionsMenu({
  contract,
  returnTo,
  onUpdated,
}: {
  contract: ContractListItem;
  returnTo: string;
  onUpdated?: (contract: ContractListItem) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "paid">("menu");
  const [renewedAt, setRenewedAt] = useState(todayInputDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const editHref = `/dashboard/contracts/edit?id=${contract._id}&returnTo=${encodeURIComponent(returnTo)}`;
  const canMarkPaid = Boolean(contract.renewalDueDate);

  function closeMenu() {
    setOpen(false);
    setMode("menu");
    setError(null);
    setSaving(false);
  }

  useEffect(() => {
    if (!open) return;

    function positionPanel() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      closeMenu();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }

    positionPanel();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open]);

  async function handleMarkPaid() {
    if (!token || !canMarkPaid || !renewedAt) return;

    setSaving(true);
    setError(null);

    try {
      const { contract: updated } = await renewContract(token, contract._id, {
        renewedAt,
        durationMonths: contract.durationMonths || 12,
        notes: "Marked as paid",
      });
      closeMenu();
      onUpdated?.(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to mark as paid.",
      );
      setSaving(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Contract actions"
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          setRenewedAt(todayInputDate());
          setMode("menu");
          setError(null);
          setOpen(true);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-brand-dark"
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              className="fixed z-[70] w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white text-brand-dark shadow-lg"
              style={{ top: coords.top, right: coords.right }}
            >
              {mode === "menu" ? (
                <div className="py-1">
                  <Link
                    href={editHref}
                    role="menuitem"
                    className="block px-3 py-2 text-sm hover:bg-neutral-50"
                    onClick={closeMenu}
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                    onClick={() => {
                      setRenewedAt(todayInputDate());
                      setError(null);
                      setMode("paid");
                    }}
                  >
                    Mark as paid
                  </button>
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  <label
                    htmlFor={`renewed-at-${contract._id}`}
                    className="block text-xs font-medium uppercase tracking-wide text-neutral-400"
                  >
                    Renewal date
                  </label>
                  <input
                    id={`renewed-at-${contract._id}`}
                    type="date"
                    value={renewedAt}
                    onChange={(e) => setRenewedAt(e.target.value)}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
                  />
                  {!canMarkPaid ? (
                    <p className="text-xs text-neutral-500">
                      Set a renewal due date before marking paid.
                    </p>
                  ) : null}
                  {error ? (
                    <p className="text-xs text-red-600">{error}</p>
                  ) : null}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("menu");
                        setError(null);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={!canMarkPaid || !renewedAt || saving}
                      onClick={() => void handleMarkPaid()}
                      className="rounded-lg bg-brand-dark px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {saving ? "Saving…" : "Confirm"}
                    </button>
                  </div>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ContractRow({
  contract,
  showCustomer,
  canEdit,
  returnTo,
  onUpdated,
}: ContractRowProps) {
  return (
    <tr className="hover:bg-neutral-50 transition-colors">
      {showCustomer && (
        <td className="px-6 py-4 whitespace-nowrap">
          {contract.customer ? (
            <Link
              href={`/dashboard/customers/detail?id=${contract.customer._id}`}
              className="font-medium text-brand-dark hover:text-brand-orange transition-colors"
            >
              {formatCustomerRecordName(contract.customer)}
            </Link>
          ) : (
            <span className="text-neutral-400">Unknown customer</span>
          )}
        </td>
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
      {canEdit && (
        <td className="px-6 py-4 whitespace-nowrap text-right">
          <ContractActionsMenu
            contract={contract}
            returnTo={returnTo}
            onUpdated={onUpdated}
          />
        </td>
      )}
    </tr>
  );
}

function ContractMobileCard({
  contract,
  showCustomer,
  canEdit,
  returnTo,
  onUpdated,
}: ContractRowProps) {
  const title = showCustomer
    ? contract.customer
      ? formatCustomerRecordName(contract.customer)
      : "Unknown customer"
    : formatContractCatalogLabel(contract);

  return (
    <MobileDataCard
      title={title}
      badges={
        <>
          <TypeBadge contract={contract} />
          <StandingBadge contract={contract} />
        </>
      }
      fields={
        <>
          <DataField
            label="Original"
            value={formatDateOnly(contract.originalContractDate)}
          />
          <DataField
            label="Renewal"
            value={formatDateOnly(contract.renewalDueDate)}
          />
          <DataField
            label="Duration"
            value={
              contract.durationMonths ? `${contract.durationMonths} mo` : "—"
            }
          />
        </>
      }
      actions={
        canEdit ? (
          <ContractActionsMenu
            contract={contract}
            returnTo={returnTo}
            onUpdated={onUpdated}
          />
        ) : null
      }
    />
  );
}

interface ServiceContractsTableProps {
  contracts: ContractListItem[];
  showCustomer?: boolean;
  returnTo?: string;
  emptyMessage?: string;
  onUpdated?: (contract: ContractListItem) => void;
}

export default function ServiceContractsTable({
  contracts,
  showCustomer = false,
  returnTo = "/dashboard/contracts",
  emptyMessage = "No contracts yet.",
  onUpdated,
}: ServiceContractsTableProps) {
  const canEdit = useAuthStore((s) => s.hasPermission("contracts:write"));
  const colCount = (showCustomer ? 6 : 5) + (canEdit ? 1 : 0);

  const empty = (
    <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center text-sm text-neutral-500 shadow-sm">
      {emptyMessage}
    </div>
  );

  return (
    <ResponsiveDataView
      isEmpty={contracts.length === 0}
      empty={empty}
      mobile={contracts.map((contract) => (
        <ContractMobileCard
          key={contract._id}
          contract={contract}
          showCustomer={showCustomer}
          canEdit={canEdit}
          returnTo={returnTo}
          onUpdated={onUpdated}
        />
      ))}
      desktop={
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
                  {canEdit && (
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {contracts.map((contract) => (
                  <ContractRow
                    key={contract._id}
                    contract={contract}
                    showCustomer={showCustomer}
                    canEdit={canEdit}
                    returnTo={returnTo}
                    onUpdated={onUpdated}
                  />
                ))}
                {contracts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="px-6 py-12 text-center text-neutral-500"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
