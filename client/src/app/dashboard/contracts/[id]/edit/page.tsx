"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { getContract, updateContract, ContractListItem, ApiError } from "@/lib/api";

function toInputDate(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function safeReturnTo(value: string | null): string {
  if (value && value.startsWith("/dashboard")) return value;
  return "/dashboard/contracts";
}

function EditContractContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnTo = safeReturnTo(searchParams.get("returnTo"));

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWrite = useAuthStore((s) => s.hasPermission("contracts:write"));

  const [contract, setContract] = useState<ContractListItem | null>(null);
  const [contractDate, setContractDate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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

    setLoading(true);
    setError(null);

    getContract(token, id)
      .then(({ contract: c }) => {
        setContract(c);
        setContractDate(toInputDate(c.contractDate));
        setDescription(c.description);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load contract.")
      )
      .finally(() => setLoading(false));
  }, [token, id, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !contract) return;

    setSaving(true);
    setSaveError(null);

    try {
      await updateContract(token, contract._id, {
        contractDate: contractDate ? contractDate : null,
        description,
      });
      router.push(returnTo);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save contract.");
    } finally {
      setSaving(false);
    }
  }

  if (!user || user.role === "customer") return null;

  if (loading) {
    return <div className="text-sm text-neutral-500 py-6">Loading contract…</div>;
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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-brand-dark">Edit Service Contract</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Update contract details for{" "}
          {contract.customer ? (
            <Link
              href={`/dashboard/customers/${contract.customer._id}`}
              className="text-brand-orange hover:underline"
            >
              {customerName}
            </Link>
          ) : (
            customerName
          )}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-5"
      >
        {saveError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div>
          <label
            htmlFor="contractDate"
            className="block text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5"
          >
            Contract Date
          </label>
          <input
            id="contractDate"
            type="date"
            value={contractDate}
            onChange={(e) => setContractDate(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
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
    </div>
  );
}

export default function EditContractPage() {
  return (
    <AuthGuard>
      <EditContractContent />
    </AuthGuard>
  );
}
