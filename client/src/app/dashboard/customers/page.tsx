"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { getCustomers, CustomerListItem, ApiError } from "@/lib/api";

function matchesSearch(customer: CustomerListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const name = `${customer.first} ${customer.last}`.toLowerCase();
  const location = [customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const phone = customer.phone.replace(/\D/g, "");
  const qDigits = q.replace(/\D/g, "");

  return (
    name.includes(q) ||
    location.includes(q) ||
    customer.phone.toLowerCase().includes(q) ||
    (qDigits.length > 0 && phone.includes(qDigits))
  );
}

function CustomersContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filteredCustomers = useMemo(
    () => customers.filter((c) => matchesSearch(c, search)),
    [customers, search]
  );

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!token || user?.role === "customer") return;

    getCustomers(token)
      .then(({ customers: list }) => setCustomers(list))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load customers.")
      )
      .finally(() => setLoading(false));
  }, [token, user]);

  if (!user || user.role === "customer") return null;

  if (loading) return <div className="text-sm text-neutral-500 py-6">Loading customers…</div>;
  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Customers</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {search.trim()
              ? `${filteredCustomers.length} of ${customers.length} customers`
              : `${customers.length} total`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, location, or phone…"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
          />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-100 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Location
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Generator
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Last Service
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-neutral-500">
                    {search.trim() ? "No customers match your search." : "No customers found."}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr
                    key={customer._id}
                    onClick={() => router.push(`/dashboard/customers/${customer._id}`)}
                    className="cursor-pointer transition-colors hover:bg-neutral-50"
                  >
                    <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                      {customer.first} {customer.last}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {customer.email || "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {customer.phone || "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {[customer.city, customer.state, customer.zip].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {customer.generatorModel || "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-500 whitespace-nowrap">
                      {customer.lastSvc
                        ? new Date(customer.lastSvc).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  return (
    <AuthGuard>
      <CustomersContent />
    </AuthGuard>
  );
}
