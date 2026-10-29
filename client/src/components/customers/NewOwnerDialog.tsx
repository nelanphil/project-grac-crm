"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, UserRound, X } from "lucide-react";
import {
  ApiError,
  CustomerContact,
  CustomerDetail,
  DirectoryContact,
  assignCustomerNewOwner,
  searchDirectoryContacts,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";
import PhoneInput from "@/components/ui/PhoneInput";

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "—";
}

type NewOwnerResult = {
  customer: {
    accountName: string;
    first: string;
    last: string;
    phone: string;
    email: string;
  };
  contacts: CustomerContact[];
};

interface NewOwnerDialogProps {
  open: boolean;
  onClose: () => void;
  token: string;
  customer: CustomerDetail;
  onSaved: (result: NewOwnerResult) => void;
}

const emptyForm = { first: "", last: "", phone: "", email: "" };

export default function NewOwnerDialog(props: NewOwnerDialogProps) {
  if (!props.open) return null;
  return <NewOwnerDialogForm {...props} />;
}

function NewOwnerDialogForm({
  onClose,
  token,
  customer,
  onSaved,
}: NewOwnerDialogProps) {
  const [form, setForm] = useState(emptyForm);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DirectoryContact[]>([]);
  const [selected, setSelected] = useState<DirectoryContact | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      searchDirectoryContacts(token, trimmed)
        .then((result) => {
          if (!cancelled) setMatches(result.contacts);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, selected, token]);

  const contacts = customer.contacts ?? [];
  const leaving = contacts.filter((contact) => contact._id !== selected?._id);
  const hasNewPerson = Boolean(
    form.first.trim() || form.last.trim() || form.phone.trim() || form.email.trim(),
  );
  const markingVacant = !selected && !hasNewPerson;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setSaving(false);
      setError("A reason is required.");
      return;
    }
    try {
      const result = selected
        ? await assignCustomerNewOwner(token, customer._id, {
            reason: trimmedReason,
            contactId: selected._id,
          })
        : hasNewPerson
          ? await assignCustomerNewOwner(token, customer._id, {
              reason: trimmedReason,
              contact: form,
            })
          : await assignCustomerNewOwner(token, customer._id, {
              reason: trimmedReason,
            });
      onSaved(result);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save the new owner.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-owner-title"
        className="flex max-h-[min(92dvh,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-start gap-2">
            <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
            <div>
              <h2 id="new-owner-title" className="text-base font-semibold text-brand-dark">
                New owner
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                The address, invoices, and work orders stay on this customer.
                Current contacts are removed from the property and kept in the
                directory.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Reason
              </span>
              <textarea
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Why is this property changing owners?"
                className="mt-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
              />
            </label>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Contacts leaving this property
              </p>
              {leaving.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">
                  {contacts.length === 0
                    ? "This property has no contacts."
                    : "The selected contact stays. Nobody else is on this property."}
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {leaving.map((contact) => (
                    <li key={contact._id} className="text-sm text-brand-dark">
                      {formatCustomerName(contact.first, contact.last) || "Unnamed contact"}
                      {contact.phone ? (
                        <span className="ml-2 text-xs text-neutral-500">
                          {formatPhone(contact.phone)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                New primary contact
              </p>
              <p className="text-sm text-neutral-500">
                Leave this blank to mark the property Vacant.
              </p>
              {selected ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2">
                  <div className="min-w-0 text-sm text-brand-dark">
                    <span className="font-medium">
                      {formatCustomerName(selected.first, selected.last) || "Unnamed contact"}
                    </span>
                    {selected.phone ? (
                      <span className="ml-2 text-xs text-neutral-500">
                        {formatPhone(selected.phone)}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="shrink-0 text-xs font-medium text-neutral-500 hover:text-brand-dark"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search an existing contact"
                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                  />
                  {query.trim().length >= 2 && matches.length === 0 ? (
                    <p className="text-xs text-neutral-500">No matching contacts</p>
                  ) : null}
                  {query.trim().length >= 2 && matches.length > 0 ? (
                    <ul className="max-h-36 space-y-1 overflow-y-auto">
                      {matches.map((match) => (
                        <li key={match._id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(match);
                              setForm(emptyForm);
                              setQuery("");
                              setMatches([]);
                            }}
                            className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white"
                          >
                            <span className="text-brand-dark">
                              {formatCustomerName(match.first, match.last) || "Unnamed contact"}
                              <span className="ml-2 text-xs text-neutral-500">
                                {formatPhone(match.phone)}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-neutral-400">
                              {match.customerName || "No customer"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="First name"
                      value={form.first}
                      onChange={(event) =>
                        setForm({ ...form, first: event.target.value })
                      }
                      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                    />
                    <input
                      type="text"
                      placeholder="Last name"
                      value={form.last}
                      onChange={(event) =>
                        setForm({ ...form, last: event.target.value })
                      }
                      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                    />
                    <PhoneInput
                      placeholder="Phone"
                      value={form.phone}
                      onChange={(event) =>
                        setForm({ ...form, phone: event.target.value })
                      }
                      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={form.email}
                      onChange={(event) =>
                        setForm({ ...form, email: event.target.value })
                      }
                      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                    />
                  </div>
                </>
              )}
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {markingVacant ? "Mark as Vacant" : "Save new owner"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
