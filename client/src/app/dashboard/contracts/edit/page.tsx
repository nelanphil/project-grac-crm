"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink from "@/components/dashboard/DashboardBackLink";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getContract,
  getCustomer,
  updateContract,
  updateContractPeriod,
  renewContract,
  deleteContract,
  restoreContract,
  ContractListItem,
  CustomerAddress,
  ApiError,
} from "@/lib/api";
import {
  STANDING_LABELS,
  STANDING_STYLES,
  computeRenewalDueDateAfterRenewal,
  formatDateOnly,
  parseDateOnly,
} from "@/lib/contractDates";
import { formatAddressLabel } from "@/components/customers/CustomerAddressesPanel";
import { formatEquipmentLabel } from "@/components/contracts/ServiceContractsTable";
import InvoiceBillingPanel from "@/components/billing/InvoiceBillingPanel";
import ProductDiscountEditor from "@/components/contracts/ProductDiscountEditor";
import { formatCustomerRecordName } from "@/lib/formatName";
import {
  DEFAULT_PRODUCT_DISCOUNTS,
  normalizeProductDiscounts,
  ProductDiscounts,
} from "@/lib/productDiscounts";

function toInputDate(date: string | null): string {
  if (!date) return "";
  const parsed = parseDateOnly(date);
  if (!parsed) return "";
  return parsed.toISOString().slice(0, 10);
}

function safeReturnTo(value: string | null): string {
  if (value && value.startsWith("/dashboard")) return value;
  return "/dashboard/contracts";
}

function EditContractContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const returnTo = safeReturnTo(searchParams.get("returnTo"));

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWrite = useAuthStore((s) => s.hasPermission("contracts:write"));
  const canEditOriginalDate = useAuthStore((s) =>
    s.hasRole("admin", "super-admin"),
  );

  const [contract, setContract] = useState<ContractListItem | null>(null);
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>(
    [],
  );
  const [addressRef, setAddressRef] = useState("");
  const [equipmentRef, setEquipmentRef] = useState("");
  const [originalContractDate, setOriginalContractDate] = useState("");
  const [contractDate, setContractDate] = useState("");
  const [durationMonths, setDurationMonths] = useState("12");
  const [description, setDescription] = useState("");
  const [renewedAt, setRenewedAt] = useState("");
  const [renewDurationMonths, setRenewDurationMonths] = useState("12");
  const [renewNotes, setRenewNotes] = useState("");
  const [overrideDiscounts, setOverrideDiscounts] = useState(false);
  const [productDiscounts, setProductDiscounts] = useState<ProductDiscounts>(
    DEFAULT_PRODUCT_DISCOUNTS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renewError, setRenewError] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodNotes, setPeriodNotes] = useState("");
  const [periodSaving, setPeriodSaving] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const hasRenewals = (contract?.renewals?.length ?? 0) > 0;
  const isDeleted = Boolean(contract?.deletedAt);

  const equipmentOptions = useMemo(() => {
    if (!addressRef) return [];
    const addr = customerAddresses.find((a) => a._id === addressRef);
    return addr?.equipment ?? [];
  }, [addressRef, customerAddresses]);

  const renewalPreview = useMemo(() => {
    if (!contract?.renewalDueDate || !renewedAt) return null;

    const renewedAtDate = parseDateOnly(renewedAt);
    const previousDueDate = parseDateOnly(contract.renewalDueDate);
    if (!renewedAtDate || !previousDueDate) return null;

    const duration = parseInt(renewDurationMonths, 10);
    if (Number.isNaN(duration) || duration < 1) return null;

    return computeRenewalDueDateAfterRenewal(
      renewedAtDate,
      previousDueDate,
      duration,
    );
  }, [contract, renewedAt, renewDurationMonths]);

  useEffect(() => {
    if (user && !canWrite) {
      router.replace(returnTo);
    }
  }, [canWrite, user, router, returnTo]);

  useEffect(() => {
    if (!token || !id) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);

    getContract(token, id)
      .then(async ({ contract: c }) => {
        setContract(c);
        setOriginalContractDate(toInputDate(c.originalContractDate));
        setContractDate(toInputDate(c.contractDate));
        setPeriodStart(toInputDate(c.contractDate));
        setPeriodEnd(toInputDate(c.renewalDueDate));
        setPeriodNotes("");
        setDurationMonths(String(c.durationMonths ?? 12));
        setDescription(c.description);
        setRenewDurationMonths(String(c.durationMonths ?? 12));
        setAddressRef(c.addressRef ?? c.address?._id ?? "");
        setEquipmentRef(c.equipmentRef ?? c.equipment?._id ?? "");
        setOverrideDiscounts(Boolean(c.productDiscounts?.override));
        setProductDiscounts(
          normalizeProductDiscounts(
            c.productDiscounts?.override
              ? c.productDiscounts
              : c.template?.productDiscounts,
          ),
        );

        if (c.customer?._id) {
          try {
            const { customer } = await getCustomer(token, c.customer._id);
            setCustomerAddresses(customer.addresses ?? []);
          } catch {
            setCustomerAddresses([]);
          }
        }
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load contract.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !contract || isDeleted) return;

    setSaving(true);
    setSaveError(null);

    const parsedDuration = parseInt(durationMonths, 10);
    if (Number.isNaN(parsedDuration) || parsedDuration < 1) {
      setSaveError("Duration must be at least 1 month.");
      setSaving(false);
      return;
    }

    try {
      const payload: {
        contractDate?: string | null;
        originalContractDate?: string | null;
        durationMonths: number;
        description: string;
        addressRef: string | null;
        equipmentRef: string | null;
        productDiscounts: {
          override: boolean;
          parts: ProductDiscounts["parts"];
          labor: ProductDiscounts["labor"];
        };
      } = {
        contractDate: contractDate ? contractDate : null,
        durationMonths: parsedDuration,
        description,
        addressRef: addressRef || null,
        equipmentRef: equipmentRef || null,
        productDiscounts: {
          override: overrideDiscounts,
          ...productDiscounts,
        },
      };

      if (canEditOriginalDate) {
        payload.originalContractDate = originalContractDate
          ? originalContractDate
          : null;
      }

      const { contract: updated } = await updateContract(
        token,
        contract._id,
        payload,
      );
      setContract(updated);
      router.push(returnTo);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save contract.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePeriod(e: FormEvent) {
    e.preventDefault();
    if (!token || !contract || isDeleted) return;

    if (!periodStart || !periodEnd || periodEnd <= periodStart) {
      setPeriodError("End date must be after the start date.");
      return;
    }

    setPeriodSaving(true);
    setPeriodError(null);

    try {
      const { contract: updated } = await updateContractPeriod(
        token,
        contract._id,
        {
          startDate: periodStart,
          endDate: periodEnd,
          notes: periodNotes || undefined,
        },
      );
      setContract(updated);
      setContractDate(toInputDate(updated.contractDate));
      setPeriodStart(toInputDate(updated.contractDate));
      setPeriodEnd(toInputDate(updated.renewalDueDate));
      setPeriodNotes("");
    } catch (err) {
      setPeriodError(
        err instanceof ApiError ? err.message : "Failed to update the period.",
      );
    } finally {
      setPeriodSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !contract || isDeleted) return;
    const confirmed = window.confirm(
      "Delete this contract? It will be hidden from lists and can be restored later. Open invoices for it will be voided.",
    );
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteContract(token, contract._id);
      router.push(returnTo);
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to delete contract.",
      );
      setDeleting(false);
    }
  }

  async function handleRestore() {
    if (!token || !contract) return;

    setRestoring(true);
    setDeleteError(null);
    try {
      const { contract: updated } = await restoreContract(token, contract._id);
      setContract(updated);
      setContractDate(toInputDate(updated.contractDate));
      setPeriodStart(toInputDate(updated.contractDate));
      setPeriodEnd(toInputDate(updated.renewalDueDate));
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to restore contract.",
      );
    } finally {
      setRestoring(false);
    }
  }

  async function handleRenew(e: FormEvent) {
    e.preventDefault();
    if (!token || !contract || isDeleted) return;

    setRenewing(true);
    setRenewError(null);

    if (!renewedAt) {
      setRenewError("Renewal date is required.");
      setRenewing(false);
      return;
    }

    const parsedDuration = parseInt(renewDurationMonths, 10);
    if (Number.isNaN(parsedDuration) || parsedDuration < 1) {
      setRenewError("Duration must be at least 1 month.");
      setRenewing(false);
      return;
    }

    try {
      const { contract: updated } = await renewContract(token, contract._id, {
        renewedAt,
        durationMonths: parsedDuration,
        notes: renewNotes || undefined,
      });
      setContract(updated);
      setRenewedAt("");
      setRenewNotes("");
      setRenewDurationMonths(String(updated.durationMonths ?? 12));
      setDurationMonths(String(updated.durationMonths ?? 12));
      setContractDate(toInputDate(updated.contractDate));
    } catch (err) {
      setRenewError(
        err instanceof ApiError ? err.message : "Failed to record renewal.",
      );
    } finally {
      setRenewing(false);
    }
  }

  if (!user) return null;

  if (loading) {
    return (
      <div className="text-sm text-neutral-500 py-6">Loading contract…</div>
    );
  }

  if (error || !contract) {
    return (
      <div className="space-y-4">
        <DashboardBackLink fallbackHref={returnTo} />
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? "Contract not found."}
        </div>
      </div>
    );
  }

  const customerName = contract.customer
    ? formatCustomerRecordName(contract.customer)
    : "Unknown customer";
  const standing = contract.standing ?? "expired";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <DashboardBackLink fallbackHref={returnTo} />
        <h1 className="mt-4 text-2xl font-bold text-brand-dark">
          Edit Service Contract
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Update contract details for{" "}
          {contract.customer ? (
            <Link
              href={`/dashboard/customers/detail?id=${contract.customer._id}`}
              className="text-brand-orange hover:underline"
            >
              {customerName}
            </Link>
          ) : (
            customerName
          )}
        </p>
      </div>

      {isDeleted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Deleted on {formatDateOnly(contract.deletedAt)}.</p>
          {canEditOriginalDate && (
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={restoring}
              className="rounded-lg bg-brand-dark px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {restoring ? "Restoring…" : "Restore"}
            </button>
          )}
        </div>
      )}
      {deleteError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STANDING_STYLES[standing]}`}
          >
            {STANDING_LABELS[standing]}
          </span>
          <span className="text-sm text-neutral-500">
            Renewal due {formatDateOnly(contract.renewalDueDate)}
          </span>
          {contract.lastRenewalDate && (
            <span className="text-sm text-neutral-500">
              Last renewed {formatDateOnly(contract.lastRenewalDate)}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          {!canEditOriginalDate && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                Original Contract Date
              </dt>
              <dd className="mt-1 text-brand-dark">
                {formatDateOnly(contract.originalContractDate)}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Current Term Start
            </dt>
            <dd className="mt-1 text-brand-dark">
              {formatDateOnly(contract.contractDate)}
            </dd>
          </div>
        </dl>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-5"
      >
        <fieldset disabled={isDeleted} className="space-y-5 disabled:opacity-60">
        <h2 className="text-lg font-semibold text-brand-dark">
          Contract Details
        </h2>

        {saveError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {hasRenewals && (
          <p className="text-sm text-neutral-500">
            {canEditOriginalDate
              ? "Term start and duration stay locked after renewals. Use Current Period below to set this term's start and end dates, or Record Renewal to start a new term."
              : "Term start and duration are locked after renewals. Use Record Renewal below to update the term."}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="addressRef"
              className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
            >
              Address
            </label>
            <select
              id="addressRef"
              value={addressRef}
              onChange={(e) => {
                const next = e.target.value;
                setAddressRef(next);
                const addr = customerAddresses.find((a) => a._id === next);
                const stillValid = addr?.equipment.some(
                  (eq) => eq._id === equipmentRef,
                );
                if (!stillValid) {
                  setEquipmentRef(
                    addr?.equipment.length === 1 ? addr.equipment[0]._id : "",
                  );
                }
              }}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
            >
              <option value="">No address</option>
              {customerAddresses.map((addr) => (
                <option key={addr._id} value={addr._id}>
                  {addr.label || formatAddressLabel(addr)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="equipmentRef"
              className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
            >
              Equipment
            </label>
            <select
              id="equipmentRef"
              value={equipmentRef}
              onChange={(e) => setEquipmentRef(e.target.value)}
              disabled={!addressRef || equipmentOptions.length === 0}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="">
                {!addressRef
                  ? "Select an address first"
                  : equipmentOptions.length === 0
                    ? "No equipment at this address"
                    : "No equipment"}
              </option>
              {equipmentOptions.map((eq) => (
                <option key={eq._id} value={eq._id}>
                  {formatEquipmentLabel(eq)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canEditOriginalDate && (
          <div>
            <label
              htmlFor="originalContractDate"
              className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
            >
              Original Contract Date
            </label>
            <input
              id="originalContractDate"
              type="date"
              value={originalContractDate}
              onChange={(e) => setOriginalContractDate(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="contractDate"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Current Term Start
          </label>
          <input
            id="contractDate"
            type="date"
            value={contractDate}
            onChange={(e) => setContractDate(e.target.value)}
            disabled={hasRenewals}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </div>

        <div>
          <label
            htmlFor="durationMonths"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Duration (months)
          </label>
          <input
            id="durationMonths"
            type="number"
            min={1}
            value={durationMonths}
            onChange={(e) => setDurationMonths(e.target.value)}
            disabled={hasRenewals}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange resize-y min-h-[8rem]"
          />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Parts & labor discounts
          </p>
          <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={overrideDiscounts}
              onChange={(e) => {
                const next = e.target.checked;
                setOverrideDiscounts(next);
                if (!next) {
                  setProductDiscounts(
                    normalizeProductDiscounts(
                      contract.template?.productDiscounts,
                    ),
                  );
                }
              }}
            />
            Override catalog discounts
          </label>
          <ProductDiscountEditor
            value={
              overrideDiscounts
                ? productDiscounts
                : normalizeProductDiscounts(contract.template?.productDiscounts)
            }
            onChange={setProductDiscounts}
            disabled={!overrideDiscounts}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <Link
            href={returnTo}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            Cancel
          </Link>
        </div>
        </fieldset>
      </form>

      {canEditOriginalDate && (
        <form
          onSubmit={handleUpdatePeriod}
          className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-5"
        >
          <fieldset disabled={isDeleted} className="space-y-5 disabled:opacity-60">
            <div>
              <h2 className="text-lg font-semibold text-brand-dark">
                Current Period
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                Set the start and end of the term this contract is in now.
                Renewal history is left unchanged.
              </p>
            </div>

            {periodError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {periodError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="periodStart"
                  className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
                >
                  Period start
                </label>
                <input
                  id="periodStart"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
                />
              </div>
              <div>
                <label
                  htmlFor="periodEnd"
                  className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
                >
                  Period end
                </label>
                <input
                  id="periodEnd"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="periodNotes"
                className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
              >
                Notes
              </label>
              <textarea
                id="periodNotes"
                value={periodNotes}
                onChange={(e) => setPeriodNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange resize-y"
              />
            </div>

            <button
              type="submit"
              disabled={periodSaving}
              className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {periodSaving ? "Updating…" : "Update Period"}
            </button>
          </fieldset>
        </form>
      )}

      <form
        onSubmit={handleRenew}
        className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-5"
      >
        <fieldset disabled={isDeleted} className="space-y-5 disabled:opacity-60">
        <h2 className="text-lg font-semibold text-brand-dark">
          Record Renewal
        </h2>

        {renewError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {renewError}
          </div>
        )}

        <div>
          <label
            htmlFor="renewedAt"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Renewal Date
          </label>
          <input
            id="renewedAt"
            type="date"
            value={renewedAt}
            onChange={(e) => setRenewedAt(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
          />
        </div>

        <div>
          <label
            htmlFor="renewDurationMonths"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Term Duration (months)
          </label>
          <input
            id="renewDurationMonths"
            type="number"
            min={1}
            value={renewDurationMonths}
            onChange={(e) => setRenewDurationMonths(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
          />
        </div>

        <div>
          <label
            htmlFor="renewNotes"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Notes
          </label>
          <textarea
            id="renewNotes"
            value={renewNotes}
            onChange={(e) => setRenewNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange resize-y"
          />
        </div>

        {renewalPreview && (
          <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-4 py-3 text-sm text-neutral-600">
            Next renewal due:{" "}
            <span className="font-medium text-brand-dark">
              {formatDateOnly(renewalPreview.newDueDate)}
            </span>
            {renewalPreview.wasLate
              ? " (late renewal — cycle reset)"
              : " (on-time — anniversary preserved)"}
          </div>
        )}

        <button
          type="submit"
          disabled={renewing || !contract.renewalDueDate}
          className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {renewing ? "Recording…" : "Record Renewal"}
        </button>
        </fieldset>
      </form>

      {contract && token ? (
        <InvoiceBillingPanel
          token={token}
          sourceType="contract_renewal"
          contractRef={contract._id}
          title="Renewal invoice"
        />
      ) : null}

      {(contract.renewals?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-brand-dark">
            Renewal History
          </h2>
          <ul className="divide-y divide-neutral-100 text-sm">
            {[...(contract.renewals ?? [])].reverse().map((renewal) => (
              <li
                key={
                  renewal._id ?? `${renewal.renewedAt}-${renewal.newDueDate}`
                }
                className="py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-brand-dark">
                    {formatDateOnly(renewal.renewedAt)}
                  </span>
                  <span className="text-neutral-400">→</span>
                  <span className="text-neutral-600">
                    due {formatDateOnly(renewal.newDueDate)}
                  </span>
                  <span className="text-neutral-500">
                    ({renewal.durationMonths} mo
                    {renewal.wasLate ? ", late" : ""})
                  </span>
                </div>
                {renewal.notes && (
                  <p className="mt-1 text-neutral-500">{renewal.notes}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEditOriginalDate && !isDeleted && (
        <div className="rounded-xl border border-red-200 bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-lg font-semibold text-brand-dark">
            Delete contract
          </h2>
          <p className="text-sm text-neutral-500">
            Hides this contract from lists and renewal runs. Open invoices are
            voided. You can restore it later from Show deleted.
          </p>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete contract"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function EditContractPage() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <EditContractContent />
      </Suspense>
    </AuthGuard>
  );
}
