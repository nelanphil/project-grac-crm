"use client";

import { FormEvent, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  ApiError,
  createPortalAddress,
  createPortalContact,
  deletePortalAddress,
  deletePortalContact,
  updatePortalAddress,
  updatePortalContact,
  type PortalAddress,
  type PortalContact,
  type PortalCustomer,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";
import { formatUsPhoneInput } from "@/lib/formatPhone";
import PhoneInput from "@/components/ui/PhoneInput";

const fieldClass =
  "rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm uppercase outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange";

function formatAddressLine(addr: PortalAddress): string {
  return [addr.address, addr.city, addr.state, addr.zip].filter(Boolean).join(", ");
}

function formatPhoneDisplay(phone: string): string {
  const formatted = formatUsPhoneInput(phone);
  return formatted || "—";
}

function contactLabel(label: string, isPrimary: boolean): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (isPrimary && trimmed.toLowerCase() === "primary") return "";
  return trimmed;
}

function isHomeownerLabel(label: string): boolean {
  return /^\s*home\s*owner\s*$/i.test(label);
}

function isPrimaryLikeLabel(label: string): boolean {
  return /^\s*primary\s*$/i.test(label);
}

function resolveContactLabel(label: string, isHomeowner: boolean): string {
  if (isHomeowner) {
    if (!label.trim() || isPrimaryLikeLabel(label) || isHomeownerLabel(label)) {
      return "Home Owner";
    }
    return label;
  }
  if (isHomeownerLabel(label)) return "";
  return label;
}

const innerCardClass =
  "rounded-lg border border-neutral-100 bg-neutral-50 p-4";

function replaceAddress(
  customers: PortalCustomer[],
  updated: PortalAddress,
): PortalCustomer[] {
  return customers.map((customer) => {
    const belongs = customer.addresses.some((address) => address._id === updated._id);
    if (!belongs) return customer;
    return {
      ...customer,
      addresses: customer.addresses.map((address) =>
        address._id === updated._id
          ? updated
          : updated.isPrimary
            ? { ...address, isPrimary: false }
            : address,
      ),
    };
  });
}

function removeAddress(
  customers: PortalCustomer[],
  addressId: string,
): PortalCustomer[] {
  return customers.map((customer) => {
    if (!customer.addresses.some((address) => address._id === addressId)) {
      return customer;
    }
    const addresses = customer.addresses.filter(
      (address) => address._id !== addressId,
    );
    const hasPrimary = addresses.some((address) => address.isPrimary);
    return {
      ...customer,
      addresses: hasPrimary
        ? addresses
        : addresses.map((address, index) => ({
            ...address,
            isPrimary: index === 0,
          })),
    };
  });
}

function removeContact(
  customers: PortalCustomer[],
  contactId: string,
): PortalCustomer[] {
  return customers.map((customer) => {
    if (!customer.contacts.some((contact) => contact._id === contactId)) {
      return customer;
    }
    const contacts = customer.contacts.filter(
      (contact) => contact._id !== contactId,
    );
    const hasPrimary = contacts.some((contact) => contact.isPrimary);
    return {
      ...customer,
      contacts: hasPrimary
        ? contacts
        : contacts.map((contact, index) => ({
            ...contact,
            isPrimary: index === 0,
          })),
    };
  });
}

function replaceContact(
  customers: PortalCustomer[],
  updated: PortalContact,
): PortalCustomer[] {
  const updatedIsHomeowner = isHomeownerLabel(updated.label);
  return customers.map((customer) => {
    const belongs = customer.contacts.some((contact) => contact._id === updated._id);
    if (!belongs) return customer;
    return {
      ...customer,
      contacts: customer.contacts.map((contact) => {
        if (contact._id === updated._id) return updated;
        let next = contact;
        if (updated.isPrimary && contact.isPrimary) {
          next = { ...next, isPrimary: false };
        }
        if (updatedIsHomeowner && isHomeownerLabel(contact.label)) {
          next = { ...next, label: "" };
        }
        return next;
      }),
    };
  });
}

function appendAddress(
  customers: PortalCustomer[],
  customerId: string,
  address: PortalAddress,
): PortalCustomer[] {
  if (customers.some((customer) => customer._id === customerId)) {
    return customers.map((customer) =>
      customer._id === customerId
        ? {
            ...customer,
            addresses: [
              ...customer.addresses.map((existing) =>
                address.isPrimary
                  ? { ...existing, isPrimary: false }
                  : existing,
              ),
              address,
            ],
          }
        : customer,
    );
  }
  return [
    ...customers,
    {
      _id: customerId,
      accountName: "",
      addresses: [address],
      contacts: [],
    },
  ];
}

function appendContact(
  customers: PortalCustomer[],
  customerId: string,
  contact: PortalContact,
): PortalCustomer[] {
  if (customers.some((customer) => customer._id === customerId)) {
    const newIsHomeowner = isHomeownerLabel(contact.label);
    return customers.map((customer) =>
      customer._id === customerId
        ? {
            ...customer,
            contacts: [
              ...customer.contacts.map((existing) => {
                let next = existing;
                if (contact.isPrimary && existing.isPrimary) {
                  next = { ...next, isPrimary: false };
                }
                if (newIsHomeowner && isHomeownerLabel(existing.label)) {
                  next = { ...next, label: "" };
                }
                return next;
              }),
              contact,
            ],
          }
        : customer,
    );
  }
  return [
    ...customers,
    {
      _id: customerId,
      accountName: "",
      addresses: [],
      contacts: [contact],
    },
  ];
}

const emptyAddressForm = {
  label: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  isPrimary: false,
};

const emptyContactForm = {
  first: "",
  last: "",
  phone: "",
  email: "",
  label: "",
  isPrimary: false,
  isHomeowner: false,
};

const checkboxClass =
  "rounded border-neutral-300 text-brand-orange focus:ring-brand-orange";

function AddressCard({
  address,
  token,
  onSaved,
  onDeleted,
  onError,
}: {
  address: PortalAddress;
  token: string;
  onSaved: (address: PortalAddress) => void;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: address.label,
    address: address.address,
    city: address.city,
    state: address.state,
    zip: address.zip,
    isPrimary: address.isPrimary,
  });

  function startEdit() {
    setForm({
      label: address.label,
      address: address.address,
      city: address.city,
      state: address.state,
      zip: address.zip,
      isPrimary: address.isPrimary,
    });
    onError(null);
    setEditing(true);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    onError(null);
    try {
      const { address: updated } = await updatePortalAddress(
        token,
        address._id,
        form,
      );
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to update address.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimary() {
    setSaving(true);
    onError(null);
    try {
      const { address: updated } = await updatePortalAddress(
        token,
        address._id,
        { isPrimary: true },
      );
      onSaved(updated);
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : "Failed to set primary address.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this address?")) return;
    setSaving(true);
    onError(null);
    try {
      await deletePortalAddress(token, address._id);
      onDeleted();
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to delete address.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className={`space-y-3 ${innerCardClass}`}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Label (optional)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className={`sm:col-span-2 ${fieldClass}`}
          />
          <input
            type="text"
            placeholder="Street address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className={`sm:col-span-2 ${fieldClass}`}
          />
          <input
            type="text"
            placeholder="City"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className={fieldClass}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="State"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              className={fieldClass}
            />
            <input
              type="text"
              placeholder="ZIP"
              value={form.zip}
              onChange={(e) => setForm({ ...form, zip: e.target.value })}
              className={fieldClass}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={form.isPrimary}
            onChange={(e) =>
              setForm({ ...form, isPrimary: e.target.checked })
            }
            className={checkboxClass}
          />
          Primary address
        </label>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleDelete}
            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
          >
            Delete
          </button>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
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
        </div>
      </form>
    );
  }

  const line = formatAddressLine(address);
  return (
    <div className={innerCardClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-brand-dark">
              {address.label.trim() || "Service address"}
            </p>
            {address.isPrimary ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300">
                Primary
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-neutral-600">{line || "—"}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-3">
          {!address.isPrimary ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleSetPrimary}
              className="text-sm font-medium text-brand-orange hover:underline disabled:opacity-50"
            >
              Set primary
            </button>
          ) : null}
          <button
            type="button"
            onClick={startEdit}
            className="text-sm font-medium text-brand-dark hover:underline"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  token,
  canDelete,
  onSaved,
  onDeleted,
  onError,
}: {
  contact: PortalContact;
  token: string;
  canDelete: boolean;
  onSaved: (contact: PortalContact) => void;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first: contact.first,
    last: contact.last,
    phone: contact.phone,
    email: contact.email,
    label: contact.label,
    isPrimary: contact.isPrimary,
    isHomeowner: isHomeownerLabel(contact.label),
  });

  function startEdit() {
    setForm({
      first: contact.first,
      last: contact.last,
      phone: contact.phone,
      email: contact.email,
      label: contact.label,
      isPrimary: contact.isPrimary,
      isHomeowner: isHomeownerLabel(contact.label),
    });
    onError(null);
    setEditing(true);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    onError(null);
    try {
      const { contact: updated } = await updatePortalContact(
        token,
        contact._id,
        {
          first: form.first,
          last: form.last,
          phone: form.phone,
          email: form.email,
          label: resolveContactLabel(form.label, form.isHomeowner),
          isPrimary: form.isPrimary,
        },
      );
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to update contact.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimary() {
    setSaving(true);
    onError(null);
    try {
      const { contact: updated } = await updatePortalContact(
        token,
        contact._id,
        { isPrimary: true },
      );
      onSaved(updated);
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : "Failed to set primary contact.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this contact?")) return;
    setSaving(true);
    onError(null);
    try {
      await deletePortalContact(token, contact._id);
      onDeleted();
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to delete contact.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className={`space-y-3 ${innerCardClass}`}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            placeholder="First name"
            value={form.first}
            onChange={(e) => setForm({ ...form, first: e.target.value })}
            className={fieldClass}
          />
          <input
            type="text"
            placeholder="Last name"
            value={form.last}
            onChange={(e) => setForm({ ...form, last: e.target.value })}
            className={fieldClass}
          />
          <PhoneInput
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={fieldClass}
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={fieldClass}
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={form.label}
            onChange={(e) =>
              setForm({
                ...form,
                label: e.target.value,
                isHomeowner: isHomeownerLabel(e.target.value),
              })
            }
            className={`sm:col-span-2 ${fieldClass}`}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) =>
                setForm({ ...form, isPrimary: e.target.checked })
              }
              className={checkboxClass}
            />
            Primary contact
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={form.isHomeowner}
              onChange={(e) => {
                const isHomeowner = e.target.checked;
                setForm({
                  ...form,
                  isHomeowner,
                  label: resolveContactLabel(form.label, isHomeowner),
                });
              }}
              className={checkboxClass}
            />
            Home owner
          </label>
        </div>
        <div className="flex items-center justify-between gap-2">
          {canDelete ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleDelete}
              className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
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
        </div>
      </form>
    );
  }

  const name = formatCustomerName(contact.first, contact.last);
  const roleLabel = contactLabel(contact.label, contact.isPrimary);
  return (
    <div className={innerCardClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-brand-dark">
              {name || "Unnamed contact"}
            </p>
            {contact.isPrimary ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300">
                Primary
              </span>
            ) : null}
            {roleLabel ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300">
                {roleLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {formatPhoneDisplay(contact.phone)}
          </p>
          <p className="mt-0.5 text-sm text-neutral-500">
            {contact.email.trim() || "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-3">
          {!contact.isPrimary ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleSetPrimary}
              className="text-sm font-medium text-brand-orange hover:underline disabled:opacity-50"
            >
              Set primary
            </button>
          ) : null}
          <button
            type="button"
            onClick={startEdit}
            className="text-sm font-medium text-brand-dark hover:underline"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PortalAccountCards({
  customers,
  token,
  loading,
  onCustomersChange,
}: {
  customers: PortalCustomer[];
  token: string;
  loading: boolean;
  onCustomersChange: (customers: PortalCustomer[]) => void;
}) {
  const [addressError, setAddressError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [addressForm, setAddressForm] = useState(emptyAddressForm);
  const [contactForm, setContactForm] = useState(emptyContactForm);

  const withSites = customers.filter((c) => c.addresses.length > 0);
  const profile = withSites.length > 0 ? withSites : customers;
  const addressGroups = profile.filter((c) => c.addresses.length > 0);
  const contactGroups = profile.filter((c) => c.contacts.length > 0);
  const showAddressHeadings = addressGroups.length > 1;
  const showContactHeadings = contactGroups.length > 1;
  const canAdd = !loading && customers.length > 0;

  async function handleAddAddress(event: FormEvent) {
    event.preventDefault();
    setSavingAddress(true);
    setAddressError(null);
    try {
      const { address, customerId } = await createPortalAddress(
        token,
        addressForm,
      );
      onCustomersChange(appendAddress(customers, customerId, address));
      setAddressForm(emptyAddressForm);
      setAddingAddress(false);
    } catch (err) {
      setAddressError(
        err instanceof ApiError ? err.message : "Failed to add address.",
      );
    } finally {
      setSavingAddress(false);
    }
  }

  async function handleAddContact(event: FormEvent) {
    event.preventDefault();
    setSavingContact(true);
    setContactError(null);
    try {
      const { contact, customerId } = await createPortalContact(token, {
        first: contactForm.first,
        last: contactForm.last,
        phone: contactForm.phone,
        email: contactForm.email,
        label: resolveContactLabel(contactForm.label, contactForm.isHomeowner),
        isPrimary: contactForm.isPrimary,
      });
      onCustomersChange(appendContact(customers, customerId, contact));
      setContactForm(emptyContactForm);
      setAddingContact(false);
    } catch (err) {
      setContactError(
        err instanceof ApiError ? err.message : "Failed to add contact.",
      );
    } finally {
      setSavingContact(false);
    }
  }

  return (
    <div className="mt-6 grid items-start gap-6 border-t border-neutral-100 pt-6 md:grid-cols-2">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-brand-dark">Addresses</h3>
          {canAdd && !addingAddress ? (
            <button
              type="button"
              onClick={() => {
                setAddressError(null);
                setAddingAddress(true);
              }}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-dark hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          ) : null}
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-neutral-500">Loading addresses…</p>
        ) : (
          <div className="mt-3 space-y-3">
            {addressError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {addressError}
              </div>
            ) : null}
            {addingAddress ? (
              <form
                onSubmit={handleAddAddress}
                className={`space-y-3 ${innerCardClass}`}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Label (optional)"
                    value={addressForm.label}
                    onChange={(e) =>
                      setAddressForm({ ...addressForm, label: e.target.value })
                    }
                    className={`sm:col-span-2 ${fieldClass}`}
                  />
                  <input
                    type="text"
                    placeholder="Street address"
                    required
                    value={addressForm.address}
                    onChange={(e) =>
                      setAddressForm({
                        ...addressForm,
                        address: e.target.value,
                      })
                    }
                    className={`sm:col-span-2 ${fieldClass}`}
                  />
                  <input
                    type="text"
                    placeholder="City"
                    value={addressForm.city}
                    onChange={(e) =>
                      setAddressForm({ ...addressForm, city: e.target.value })
                    }
                    className={fieldClass}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="State"
                      value={addressForm.state}
                      onChange={(e) =>
                        setAddressForm({
                          ...addressForm,
                          state: e.target.value,
                        })
                      }
                      className={fieldClass}
                    />
                    <input
                      type="text"
                      placeholder="ZIP"
                      value={addressForm.zip}
                      onChange={(e) =>
                        setAddressForm({ ...addressForm, zip: e.target.value })
                      }
                      className={fieldClass}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={addressForm.isPrimary}
                    onChange={(e) =>
                      setAddressForm({
                        ...addressForm,
                        isPrimary: e.target.checked,
                      })
                    }
                    className={checkboxClass}
                  />
                  Primary address
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingAddress(false);
                      setAddressForm(emptyAddressForm);
                    }}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingAddress}
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
                  >
                    {savingAddress ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Save
                  </button>
                </div>
              </form>
            ) : null}
            {addressGroups.length === 0 && !addingAddress ? (
              <p className="text-sm text-neutral-500">No address on file.</p>
            ) : (
              addressGroups.map((customer) => (
                <div key={`addr-${customer._id}`} className="space-y-3">
                  {showAddressHeadings ? (
                    <p className="text-xs font-semibold tracking-wide text-neutral-400">
                      {customer.accountName || "Customer"}
                    </p>
                  ) : null}
                  {customer.addresses.map((address) => (
                    <AddressCard
                      key={address._id}
                      address={address}
                      token={token}
                      onError={setAddressError}
                      onSaved={(updated) =>
                        onCustomersChange(replaceAddress(customers, updated))
                      }
                      onDeleted={() =>
                        onCustomersChange(removeAddress(customers, address._id))
                      }
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-brand-dark">Contacts</h3>
          {canAdd && !addingContact ? (
            <button
              type="button"
              onClick={() => {
                setContactError(null);
                setAddingContact(true);
              }}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-dark hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          ) : null}
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-neutral-500">Loading contacts…</p>
        ) : (
          <div className="mt-3 space-y-3">
            {contactError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {contactError}
              </div>
            ) : null}
            {addingContact ? (
              <form
                onSubmit={handleAddContact}
                className={`space-y-3 ${innerCardClass}`}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="First name"
                    required
                    value={contactForm.first}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, first: e.target.value })
                    }
                    className={fieldClass}
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={contactForm.last}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, last: e.target.value })
                    }
                    className={fieldClass}
                  />
                  <PhoneInput
                    placeholder="Phone"
                    value={contactForm.phone}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, phone: e.target.value })
                    }
                    className={fieldClass}
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={contactForm.email}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, email: e.target.value })
                    }
                    className={fieldClass}
                  />
                  <input
                    type="text"
                    placeholder="Label (optional)"
                    value={contactForm.label}
                    onChange={(e) =>
                      setContactForm({
                        ...contactForm,
                        label: e.target.value,
                        isHomeowner: isHomeownerLabel(e.target.value),
                      })
                    }
                    className={`sm:col-span-2 ${fieldClass}`}
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={contactForm.isPrimary}
                      onChange={(e) =>
                        setContactForm({
                          ...contactForm,
                          isPrimary: e.target.checked,
                        })
                      }
                      className={checkboxClass}
                    />
                    Primary contact
                  </label>
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={contactForm.isHomeowner}
                      onChange={(e) => {
                        const isHomeowner = e.target.checked;
                        setContactForm({
                          ...contactForm,
                          isHomeowner,
                          label: resolveContactLabel(
                            contactForm.label,
                            isHomeowner,
                          ),
                        });
                      }}
                      className={checkboxClass}
                    />
                    Home owner
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingContact(false);
                      setContactForm(emptyContactForm);
                    }}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingContact}
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
                  >
                    {savingContact ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Save
                  </button>
                </div>
              </form>
            ) : null}
            {contactGroups.length === 0 && !addingContact ? (
              <p className="text-sm text-neutral-500">No contacts on file.</p>
            ) : (
              contactGroups.map((customer) => (
                <div key={`contact-${customer._id}`} className="space-y-3">
                  {showContactHeadings ? (
                    <p className="text-xs font-semibold tracking-wide text-neutral-400">
                      {customer.accountName || "Customer"}
                    </p>
                  ) : null}
                  {customer.contacts.map((contact) => (
                    <ContactCard
                      key={contact._id}
                      contact={contact}
                      token={token}
                      canDelete={customer.contacts.length > 1}
                      onError={setContactError}
                      onSaved={(updated) =>
                        onCustomersChange(replaceContact(customers, updated))
                      }
                      onDeleted={() =>
                        onCustomersChange(removeContact(customers, contact._id))
                      }
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
