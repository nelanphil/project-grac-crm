"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Plus, UserRound } from "lucide-react";
import {
  ApiError,
  CustomerContact,
  CustomerDetail,
  createCustomerContact,
  deleteCustomerContact,
  updateCustomerContact,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";
import CustomerNotesPanel from "./CustomerNotesPanel";

type ViewMode = "contact" | "notes";

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "—";
}

interface ContactCardProps {
  customer: CustomerDetail;
  token: string;
  userId: string;
  canWrite?: boolean;
  onCustomerChange?: (customer: CustomerDetail) => void;
}

type ContactFormState = {
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
};

const emptyForm: ContactFormState = {
  first: "",
  last: "",
  phone: "",
  email: "",
  label: "",
};

function applyPrimaryToCustomer(
  customer: CustomerDetail,
  contacts: CustomerContact[]
): CustomerDetail {
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  return {
    ...customer,
    contacts,
    first: primary?.first ?? customer.first,
    last: primary?.last ?? customer.last,
    phone: primary?.phone ?? customer.phone,
    email: primary?.email ?? customer.email,
  };
}

export default function ContactCard({
  customer,
  token,
  userId,
  canWrite = false,
  onCustomerChange,
}: ContactCardProps) {
  const [view, setView] = useState<ViewMode>("contact");
  const [contacts, setContacts] = useState<CustomerContact[]>(
    customer.contacts ?? []
  );
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContacts(customer.contacts ?? []);
  }, [customer.contacts]);

  const primaryAddress =
    customer.addresses?.find((a) => a.isPrimary) ?? customer.addresses?.[0];
  const fullAddress = primaryAddress
    ? [primaryAddress.address, primaryAddress.city, primaryAddress.state, primaryAddress.zip]
        .filter(Boolean)
        .join(", ")
    : [customer.address, customer.city, customer.state, customer.zip]
        .filter(Boolean)
        .join(", ");

  function publishContacts(next: CustomerContact[]) {
    setContacts(next);
    onCustomerChange?.(applyPrimaryToCustomer(customer, next));
  }

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setAdding(true);
    setError(null);
  }

  function startEdit(contact: CustomerContact) {
    setAdding(false);
    setEditingId(contact._id);
    setForm({
      first: contact.first,
      last: contact.last,
      phone: contact.phone,
      email: contact.email,
      label: contact.label,
    });
    setError(null);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const { contact } = await updateCustomerContact(
          token,
          customer._id,
          editingId,
          form
        );
        const next = contacts.map((c) => (c._id === contact._id ? contact : c));
        publishContacts(next);
      } else {
        const { contact } = await createCustomerContact(token, customer._id, {
          ...form,
          isPrimary: contacts.length === 0,
        });
        publishContacts([...contacts, contact]);
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save contact.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimary(contactId: string) {
    setSaving(true);
    setError(null);
    try {
      const { contact } = await updateCustomerContact(
        token,
        customer._id,
        contactId,
        { isPrimary: true }
      );
      const next = contacts.map((c) => ({
        ...(c._id === contact._id ? contact : c),
        isPrimary: c._id === contact._id,
      }));
      publishContacts(next);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to set primary contact."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contactId: string) {
    if (contacts.length <= 1) {
      setError("Cannot delete the last contact on a customer.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteCustomerContact(token, customer._id, contactId);
      let next = contacts.filter((c) => c._id !== contactId);
      // Backend promotes another primary when needed; mirror that locally.
      if (!next.some((c) => c.isPrimary) && next[0]) {
        next = next.map((c, index) => ({
          ...c,
          isPrimary: index === 0,
        }));
      }
      publishContacts(next);
      if (editingId === contactId) cancelForm();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete contact."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-brand-dark">
          {view === "contact" ? "Contacts" : "Notes"}
        </h2>
        <button
          type="button"
          onClick={() => setView(view === "contact" ? "notes" : "contact")}
          className="text-sm font-medium text-brand-orange hover:underline"
        >
          {view === "contact" ? "Notes" : "Contacts"}
        </button>
      </div>

      {view === "contact" ? (
        <div className="space-y-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 py-8 text-center">
              <UserRound className="mx-auto mb-2 h-7 w-7 text-neutral-300" />
              <p className="text-sm text-neutral-500">No contacts yet</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {contacts.map((contact) => (
                <li
                  key={contact._id}
                  className="rounded-lg border border-neutral-200 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-brand-dark">
                          {formatCustomerName(contact.first, contact.last) ||
                            "Unnamed contact"}
                        </span>
                        {contact.isPrimary ? (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300">
                            Primary
                          </span>
                        ) : null}
                        {contact.label?.trim() ? (
                          <span className="text-xs text-neutral-400">
                            {contact.label}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-neutral-600">
                        {formatPhone(contact.phone)}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {contact.email?.trim() || "—"}
                      </p>
                    </div>
                    {canWrite ? (
                      <div className="flex flex-wrap gap-2 text-xs">
                        {!contact.isPrimary ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleSetPrimary(contact._id)}
                            className="font-medium text-brand-orange hover:underline disabled:opacity-50"
                          >
                            Set primary
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => startEdit(contact)}
                          className="font-medium text-neutral-600 hover:underline disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={saving || contacts.length <= 1}
                          onClick={() => handleDelete(contact._id)}
                          className="font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-neutral-100 pt-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Primary address
            </dt>
            <dd className="mt-1 text-sm text-brand-dark">{fullAddress || "—"}</dd>
          </div>

          {canWrite && !adding && !editingId ? (
            <button
              type="button"
              onClick={startAdd}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline"
            >
              <Plus className="h-4 w-4" />
              Add contact
            </button>
          ) : null}

          {(adding || editingId) && canWrite ? (
            <form
              onSubmit={handleSave}
              className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {editingId ? "Edit contact" : "New contact"}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="First name"
                  value={form.first}
                  onChange={(e) => setForm({ ...form, first: e.target.value })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={form.last}
                  onChange={(e) => setForm({ ...form, last: e.target.value })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                />
                <input
                  type="text"
                  placeholder="Label (optional)"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className="sm:col-span-2 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : (
        <CustomerNotesPanel
          token={token}
          customerId={customer._id}
          userId={userId}
          limit={1}
          viewAllHref={`/dashboard/customers/${customer._id}/notes`}
          enabled={view === "notes"}
          newNoteInputId="contactCardNewNote"
        />
      )}
    </div>
  );
}
