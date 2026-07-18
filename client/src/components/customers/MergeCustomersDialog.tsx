"use client";

import { useEffect, useState } from "react";
import { GitMerge, Loader2, MapPin, Wrench, X } from "lucide-react";
import {
  ApiError,
  CustomerDetail,
  CustomerDuplicateMatch,
  CustomerListItem,
  MergePreview,
  MergePreviewAllocation,
  MergePreviewContact,
  MergePreviewContract,
  getCustomerDuplicates,
  getCustomers,
  getMergePreview,
  mergeCustomers,
} from "@/lib/api";
import {
  STANDING_LABELS,
  STANDING_STYLES,
  formatDateOnly,
} from "@/lib/contractDates";
import { formatCustomerName } from "@/lib/formatName";

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "—";
}

interface MergeCustomersDialogProps {
  open: boolean;
  onClose: () => void;
  token: string;
  survivor: CustomerDetail;
  onMerged: (customer: CustomerDetail) => void;
}

function formatAddressLine(c: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  label?: string;
}): string {
  const street = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
  if (c.label?.trim() && street) return `${c.label.trim()} — ${street}`;
  return street || c.label?.trim() || "—";
}

function formatEquipmentLine(eq: {
  generatorModel?: string;
  serial?: string;
  atsSerial?: string;
}): string {
  const model = eq.generatorModel?.trim();
  const serial = eq.serial?.trim();
  if (model && serial) return `${model} · ${serial}`;
  return model || serial || eq.atsSerial?.trim() || "Equipment";
}

function ContractPreviewRow({ contract }: { contract: MergePreviewContract }) {
  const typeLabel =
    contract.templateLabel || contract.contractType || "Contract";
  const standing = contract.standing ?? "expired";

  return (
    <li className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-brand-dark">{typeLabel}</span>
        <span
          className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STANDING_STYLES[standing]}`}
        >
          {STANDING_LABELS[standing]}
        </span>
      </div>
      <div className="mt-1 text-neutral-600">
        Renewal due {formatDateOnly(contract.renewalDueDate)}
        {contract.equipmentLabel ? ` · ${contract.equipmentLabel}` : ""}
      </div>
      {contract.description?.trim() ? (
        <p className="mt-1 line-clamp-2 text-neutral-500">
          {contract.description}
        </p>
      ) : null}
    </li>
  );
}

function ContactPreviewRow({
  contact,
  selectedPrimaryId,
  onSelectPrimary,
}: {
  contact: MergePreviewContact;
  selectedPrimaryId: string | null;
  onSelectPrimary: (id: string) => void;
}) {
  const isMoving = contact.origin === "source";
  const name =
    formatCustomerName(contact.first, contact.last) || "Unnamed contact";

  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${
        isMoving
          ? "border-orange-200 bg-orange-50/60"
          : "border-neutral-200 bg-white"
      }`}
    >
      <input
        type="radio"
        name="merge-primary-contact"
        className="mt-1"
        checked={selectedPrimaryId === contact._id}
        onChange={() => onSelectPrimary(contact._id)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-brand-dark">{name}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
              isMoving
                ? "bg-orange-100 text-orange-800 ring-orange-200"
                : "bg-neutral-100 text-neutral-600 ring-neutral-300"
            }`}
          >
            {isMoving ? "Moving in" : "Keeping"}
          </span>
          {selectedPrimaryId === contact._id ? (
            <span className="rounded-full bg-brand-orange/10 px-2 py-0.5 text-[10px] font-medium text-brand-orange ring-1 ring-inset ring-brand-orange/30">
              Primary after merge
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-neutral-600">
          {formatPhone(contact.phone)}
          {contact.email?.trim() ? ` · ${contact.email}` : ""}
          {contact.label?.trim() ? ` · ${contact.label}` : ""}
        </p>
      </div>
    </label>
  );
}

function AllocationCard({ bucket }: { bucket: MergePreviewAllocation }) {
  const isMoving = bucket.origin === "source";

  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        isMoving
          ? "border-orange-200 bg-orange-50/60"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-brand-orange" />
        <span className="text-sm font-medium text-brand-dark">
          {formatAddressLine(bucket)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isMoving
              ? "bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-600/20"
              : "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-300"
          }`}
        >
          {isMoving ? "Moving in" : "Keeping"}
        </span>
        {bucket.isPrimary ? (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300">
            Primary
          </span>
        ) : null}
      </div>

      {bucket.equipment.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {bucket.equipment.map((eq) => (
            <li
              key={eq._id}
              className="flex items-center gap-1.5 text-xs text-neutral-600"
            >
              <Wrench className="h-3 w-3 text-neutral-400" />
              {formatEquipmentLine(eq)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-neutral-400">No equipment</p>
      )}

      <p className="text-xs text-neutral-500">
        {bucket.workOrderCount} work order
        {bucket.workOrderCount === 1 ? "" : "s"}
        {" · "}
        {bucket.contracts.length} contract
        {bucket.contracts.length === 1 ? "" : "s"}
      </p>

      {bucket.contracts.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {bucket.contracts.map((c) => (
            <ContractPreviewRow key={c._id} contract={c} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function MergeCustomersDialog({
  open,
  onClose,
  token,
  survivor,
  onMerged,
}: MergeCustomersDialogProps) {
  const [duplicates, setDuplicates] = useState<CustomerDuplicateMatch[]>([]);
  const [allCustomers, setAllCustomers] = useState<CustomerListItem[]>([]);
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [primaryContactId, setPrimaryContactId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);

    setSourceId(null);

    setPreview(null);

    setPrimaryContactId(null);

    setSearch("");

    setLoadingList(true);

    Promise.all([
      getCustomerDuplicates(token, survivor.phone, survivor._id).catch(() => ({
        phone: survivor.phone,
        customers: [] as CustomerDuplicateMatch[],
      })),
      getCustomers(token),
    ])
      .then(([dupResult, { customers }]) => {
        setDuplicates(dupResult.customers);
        setAllCustomers(customers.filter((c) => c._id !== survivor._id));
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load customers.",
        ),
      )
      .finally(() => setLoadingList(false));
  }, [open, token, survivor._id, survivor.phone]);

  useEffect(() => {
    if (!open || !sourceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      setPrimaryContactId(null);
      return;
    }

    setLoadingPreview(true);
    setError(null);
    getMergePreview(token, survivor._id, sourceId)
      .then((result) => {
        setPreview(result);
        setPrimaryContactId(result.defaultPrimaryContactId);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load merge preview.",
        ),
      )
      .finally(() => setLoadingPreview(false));
  }, [open, sourceId, survivor._id, token]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const filtered = allCustomers
    .filter((c) => {
      if (!q) return false;
      const name = `${c.first} ${c.last}`.toLowerCase();
      const phone = c.phone.replace(/\D/g, "");
      const addr = [c.address, c.city, c.state, c.zip].join(" ").toLowerCase();
      return (
        name.includes(q) ||
        addr.includes(q) ||
        (qDigits.length > 0 && phone.includes(qDigits))
      );
    })
    .slice(0, 12);

  const hasUnassigned =
    preview &&
    (preview.unassigned.survivor.workOrderCount > 0 ||
      preview.unassigned.survivor.contracts.length > 0 ||
      preview.unassigned.source.workOrderCount > 0 ||
      preview.unassigned.source.contracts.length > 0);

  async function handleMerge() {
    if (!sourceId) return;
    setMerging(true);
    setError(null);
    try {
      const { customer } = await mergeCustomers(token, survivor._id, sourceId, {
        primaryContactId: primaryContactId ?? undefined,
      });
      onMerged({
        ...customer,
        addresses: customer.addresses ?? [],
        contacts: customer.contacts ?? [],
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Merge failed.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-customers-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-brand-orange" />
            <h2
              id="merge-customers-title"
              className="text-lg font-semibold text-brand-dark"
            >
              Merge into {formatCustomerName(survivor.first, survivor.last)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <p className="text-sm text-neutral-600">
            Select another customer account to merge. Review how contacts,
            addresses, equipment, work orders, and contracts will sit under this
            account before confirming.
          </p>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {loadingList ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading suggestions…
            </div>
          ) : (
            <>
              {duplicates.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Same phone number
                  </h3>
                  <ul className="space-y-2">
                    {duplicates.map((c) => (
                      <li key={c._id}>
                        <button
                          type="button"
                          onClick={() => setSourceId(c._id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            sourceId === c._id
                              ? "border-brand-orange bg-orange-50"
                              : "border-neutral-200 hover:border-neutral-300"
                          }`}
                        >
                          <div className="font-medium text-brand-dark">
                            {formatCustomerName(c.first, c.last)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {formatAddressLine(c)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Search other customers
                </label>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, phone, or address…"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                />
                {q && filtered.length > 0 ? (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {filtered.map((c) => (
                      <li key={c._id}>
                        <button
                          type="button"
                          onClick={() => setSourceId(c._id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            sourceId === c._id
                              ? "border-brand-orange bg-orange-50"
                              : "border-neutral-200 hover:border-neutral-300"
                          }`}
                        >
                          <div className="font-medium text-brand-dark">
                            {formatCustomerName(c.first, c.last)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {formatAddressLine(c)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          )}

          {sourceId ? (
            <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
              {loadingPreview || !preview ? (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading allocation preview…
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      After merge
                    </h3>
                    <p className="mt-1 text-sm text-brand-dark">
                      Merging{" "}
                      <span className="font-medium">
                        {formatCustomerName(
                          preview.source.first,
                          preview.source.last,
                        )}
                      </span>{" "}
                      into{" "}
                      <span className="font-medium">
                        {formatCustomerName(
                          preview.survivor.first,
                          preview.survivor.last,
                        )}
                      </span>
                    </p>
                    {preview.contractsFromBothSides ||
                    preview.totals.contracts > 1 ? (
                      <p className="mt-1 text-xs text-amber-800">
                        This merge combines contracts from both accounts —
                        review each address below to see where they land.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Contacts after merge
                    </h4>
                    <p className="text-xs text-neutral-500">
                      All contacts below stay on this account. Choose which one
                      should be the primary name and phone.
                    </p>
                    {(preview.contacts ?? []).length === 0 ? (
                      <p className="text-sm text-neutral-500">
                        No contacts on either account.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {(preview.contacts ?? []).map((contact) => (
                          <li key={`${contact.origin}-${contact._id}`}>
                            <ContactPreviewRow
                              contact={contact}
                              selectedPrimaryId={primaryContactId}
                              onSelectPrimary={setPrimaryContactId}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      By address
                    </h4>
                    {preview.allocation.length === 0 ? (
                      <p className="text-sm text-neutral-500">
                        No addresses on either account.
                      </p>
                    ) : (
                      preview.allocation.map((bucket) => (
                        <AllocationCard
                          key={`${bucket.origin}-${bucket._id}`}
                          bucket={bucket}
                        />
                      ))
                    )}
                  </div>

                  {hasUnassigned ? (
                    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Unassigned to an address
                      </h4>
                      <p className="mt-1 text-xs text-neutral-500">
                        These stay on the merged customer but are not tied to a
                        specific address after merge.
                      </p>
                      <ul className="mt-2 space-y-2 text-xs text-neutral-600">
                        {preview.unassigned.survivor.workOrderCount > 0 ||
                        preview.unassigned.survivor.contracts.length > 0 ? (
                          <li>
                            <span className="font-medium">Keeping:</span>{" "}
                            {preview.unassigned.survivor.workOrderCount} WO
                            {preview.unassigned.survivor.workOrderCount === 1
                              ? ""
                              : "s"}
                            , {preview.unassigned.survivor.contracts.length}{" "}
                            contract
                            {preview.unassigned.survivor.contracts.length === 1
                              ? ""
                              : "s"}
                            {preview.unassigned.survivor.contracts.length >
                            0 ? (
                              <ul className="mt-1.5 space-y-1.5">
                                {preview.unassigned.survivor.contracts.map(
                                  (c) => (
                                    <ContractPreviewRow
                                      key={c._id}
                                      contract={c}
                                    />
                                  ),
                                )}
                              </ul>
                            ) : null}
                          </li>
                        ) : null}
                        {preview.unassigned.source.workOrderCount > 0 ||
                        preview.unassigned.source.contracts.length > 0 ? (
                          <li>
                            <span className="font-medium">Moving in:</span>{" "}
                            {preview.unassigned.source.workOrderCount} WO
                            {preview.unassigned.source.workOrderCount === 1
                              ? ""
                              : "s"}
                            , {preview.unassigned.source.contracts.length}{" "}
                            contract
                            {preview.unassigned.source.contracts.length === 1
                              ? ""
                              : "s"}
                            {preview.unassigned.source.contracts.length > 0 ? (
                              <ul className="mt-1.5 space-y-1.5">
                                {preview.unassigned.source.contracts.map(
                                  (c) => (
                                    <ContractPreviewRow
                                      key={c._id}
                                      contract={c}
                                    />
                                  ),
                                )}
                              </ul>
                            ) : null}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-200 pt-3 text-xs text-neutral-600">
                    <span>
                      <span className="font-medium text-brand-dark">
                        {preview.totals.contacts ?? preview.contacts?.length ?? 0}
                      </span>{" "}
                      contacts
                    </span>
                    <span>
                      <span className="font-medium text-brand-dark">
                        {preview.totals.addresses}
                      </span>{" "}
                      addresses
                    </span>
                    <span>
                      <span className="font-medium text-brand-dark">
                        {preview.totals.equipment}
                      </span>{" "}
                      equipment
                    </span>
                    <span>
                      <span className="font-medium text-brand-dark">
                        {preview.totals.workOrders}
                      </span>{" "}
                      work orders
                    </span>
                    <span>
                      <span className="font-medium text-brand-dark">
                        {preview.totals.contracts}
                      </span>{" "}
                      contracts
                    </span>
                    <span>
                      <span className="font-medium text-brand-dark">
                        {preview.totals.notes}
                      </span>{" "}
                      notes
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!sourceId || !preview || merging || loadingPreview}
            onClick={handleMerge}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {merging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="h-4 w-4" />
            )}
            Confirm merge
          </button>
        </div>
      </div>
    </div>
  );
}
