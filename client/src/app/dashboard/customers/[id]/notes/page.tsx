"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import CustomerNotesPanel from "@/components/customers/CustomerNotesPanel";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, CustomerDetail, getCustomer } from "@/lib/api";

function CustomerNotesContent() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!token || !id || user?.role === "customer") return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);

    getCustomer(token, id)
      .then(({ customer: c }) => setCustomer(c))
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load customer.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, id, user]);

  if (!user || user.role === "customer") return null;

  if (loading) {
    return <div className="text-sm text-neutral-500 py-6">Loading notes…</div>;
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <Link
          href={`/dashboard/customers/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customer
        </Link>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? "Customer not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/customers/${customer._id}`}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {customer.first} {customer.last}
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-brand-dark">
          Customer Notes
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Notes for {customer.first} {customer.last}
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <CustomerNotesPanel
          token={token!}
          customerId={customer._id}
          userId={user.id}
          newNoteInputId="customerNotesPageNewNote"
        />
      </div>
    </div>
  );
}

export default function CustomerNotesPage() {
  return (
    <AuthGuard>
      <CustomerNotesContent />
    </AuthGuard>
  );
}
