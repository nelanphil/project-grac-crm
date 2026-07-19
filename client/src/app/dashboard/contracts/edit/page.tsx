"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getContract,
  getCustomer,
  updateContract,
  renewContract,
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renewError, setRenewError] = useState<string | null>(null);

  const hasRenewals = (contract?.renewals?.length ?? 0) > 0;

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
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (user && user.role !== "customer" && !canWrite) {
      router.replace(returnTo);
    }
  }, [canWrite, user, router, returnTo]);

  useEffect(() => {
    if (!token || !id || user?.role === "customer") return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);

    getContract(token, id)
      .then(async ({ contract: c }) => {
        setContract(c);
        setOriginalContractDate(toInputDate(c.originalContractDate));
        setContractDate(toInputDate(c.contractDate));
        setDurationMonths(String(c.durationMonths ?? 12));
        setDescription(c.description);
        setRenewDurationMonths(String(c.durationMonths ?? 12));
        setAddressRef(c.addressRef ?? c.address?._id ?? "");
        setEquipmentRef(c.equipmentRef ?? c.equipment?._id ?? "");

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
  }, [token, id, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !contract) return;

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
      } = {
        contractDate: contractDate ? contractDate : null,
        durationMonths: parsedDuration,
        description,
        addressRef: addressRef || null,
        equipmentRef: equipmentRef || null,
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

  async function handleRenew(e: FormEvent) {
    e.preventDefault();
    if (!token || !contract) return;

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

  if (!user || user.role === "customer") return null;

  if (loading) {
    return (
      <div className="text-sm text-neutral-500 py-6">Loading contract…</div>
    );
  }

  if (error || !contract) {
    return (
      <div className="space-y-4">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? "Contract not found."}
        </div>
      </div>
    );
  }

  const customerName = contract.customer
    ? `${contract.customer.first} ${contract.customer.last}`
    : "Unknown customer";
  const standing = contract.standing ?? "expired";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
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
            Term start and duration are locked after renewals. Use Record
            Renewal below to update the term.
          </p>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
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
      </form>

      <form
        onSubmit={handleRenew}
        className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-5"
      >
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
      </form>

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
