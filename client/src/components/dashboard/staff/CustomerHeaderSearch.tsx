"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { getCustomers, type CustomerListItem } from "@/lib/api";
import { formatCustomerRecordName } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 8;

function formatPhone(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatSecondaryLine(customer: CustomerListItem): string {
  const phone = formatPhone(customer.phone);
  const place = [customer.city, customer.state].filter(Boolean).join(", ");
  return [phone, place].filter(Boolean).join(" · ");
}

type CustomerHeaderSearchProps = {
  className?: string;
  inputClassName?: string;
};

export default function CustomerHeaderSearch({
  className,
  inputClassName,
}: CustomerHeaderSearchProps) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const listId = useId();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!token || !debouncedQuery) {
      requestIdRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale suggestions when query empties
      setResults([]);
      setLoading(false);
      setError(null);
      setHighlightIndex(0);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    getCustomers(token, { search: debouncedQuery, pageSize: PAGE_SIZE })
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        setResults(res.customers);
        setHighlightIndex(0);
        setOpen(true);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setError(err instanceof Error ? err.message : "Search failed");
        setOpen(true);
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [debouncedQuery, token]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  function goToList(q: string) {
    setOpen(false);
    if (!q) {
      router.push("/dashboard/customers");
      return;
    }
    router.push(`/dashboard/customers?q=${encodeURIComponent(q)}`);
  }

  function selectCustomer(customer: CustomerListItem) {
    setOpen(false);
    setQuery(formatCustomerRecordName(customer));
    router.push(`/dashboard/customers/detail?id=${customer._id}`);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (open && results.length > 0 && highlightIndex >= 0) {
      const selected = results[highlightIndex];
      if (selected) {
        selectCustomer(selected);
        return;
      }
    }
    goToList(q);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }

    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && results.length > 0) {
      setOpen(true);
      return;
    }

    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) =>
        results.length === 0 ? 0 : Math.min(i + 1, results.length - 1),
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    }
  }

  function handleFocus() {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (debouncedQuery && (results.length > 0 || error || loading)) {
      setOpen(true);
    }
  }

  function handleBlur() {
    blurTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  }

  const trimmed = query.trim();
  const searchReady =
    Boolean(debouncedQuery) && debouncedQuery === trimmed;
  const showDropdown =
    open &&
    trimmed.length > 0 &&
    (loading || error !== null || searchReady);

  return (
    <form
      onSubmit={handleSubmit}
      className={className}
      role="search"
    >
      <label className="relative block">
        <span className="sr-only">Search customers</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--staff-muted)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Search customers…"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showDropdown}
          aria-activedescendant={
            showDropdown && results[highlightIndex]
              ? `${listId}-option-${highlightIndex}`
              : undefined
          }
          role="combobox"
          className={
            inputClassName ??
            "w-full rounded-xl border border-[var(--staff-border)] bg-white py-2.5 pl-10 pr-3 text-sm text-[var(--staff-ink)] outline-none transition focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
          }
        />

        {showDropdown ? (
          <div
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-[var(--staff-border)] bg-white py-1 shadow-lg"
          >
            {loading && results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--staff-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            ) : null}

            {error ? (
              <div className="px-4 py-3 text-sm text-red-600">{error}</div>
            ) : null}

            {!loading && !error && searchReady && results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-[var(--staff-muted)]">
                No customers found
              </div>
            ) : null}

            {results.map((customer, index) => {
              const secondary = formatSecondaryLine(customer);
              const highlighted = index === highlightIndex;
              return (
                <button
                  key={customer._id}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => selectCustomer(customer)}
                  className={`flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors ${
                    highlighted
                      ? "bg-[var(--staff-cream)]"
                      : "hover:bg-[var(--staff-cream)]"
                  }`}
                >
                  <span className="truncate text-sm font-medium text-[var(--staff-ink)]">
                    {formatCustomerRecordName(customer)}
                  </span>
                  {secondary ? (
                    <span className="truncate text-xs text-[var(--staff-muted)]">
                      {secondary}
                    </span>
                  ) : null}
                </button>
              );
            })}

            {trimmed ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goToList(trimmed)}
                className="w-full border-t border-[var(--staff-border)] px-4 py-2.5 text-left text-sm font-medium text-brand-orange transition-colors hover:bg-[var(--staff-cream)]"
              >
                View all results for “{trimmed}”
              </button>
            ) : null}
          </div>
        ) : null}
      </label>
    </form>
  );
}
