"use client";

import { FormEvent, Suspense, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  CustomerAddressPropertyType,
  ValidatedAddress,
  createCustomer,
  validateCustomerAddress,
} from "@/lib/api";
import { FLORIDA_COUNTIES } from "@/lib/floridaCounties";

function safeReturnTo(value: string | null): string {
  if (value && value.startsWith("/dashboard")) return value;
  return "/dashboard/customers";
}

function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidEmail(email: string): boolean {
  if (!email.trim()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length === 10;
}

type ContactDraft = {
  key: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
};

type EquipmentDraft = {
  key: string;
  generatorModel: string;
  serial: string;
  atsSerial: string;
};

type AddressDraft = {
  key: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  countyManual: boolean;
  propertyType: CustomerAddressPropertyType;
  isPrimary: boolean;
  equipment: EquipmentDraft[];
  validated: boolean;
  validating: boolean;
  validationMsg: string | null;
  suggested: { address: ValidatedAddress; matchedAddress?: string } | null;
};

function newKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyContact(isPrimary = false): ContactDraft {
  return {
    key: newKey("contact"),
    first: "",
    last: "",
    phone: "",
    email: "",
    label: "",
    isPrimary,
  };
}

function emptyEquipment(): EquipmentDraft {
  return {
    key: newKey("eq"),
    generatorModel: "",
    serial: "",
    atsSerial: "",
  };
}

function emptyAddress(isPrimary = false): AddressDraft {
  return {
    key: newKey("addr"),
    label: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    county: "",
    countyManual: false,
    propertyType: "residential",
    isPrimary,
    equipment: [],
    validated: false,
    validating: false,
    validationMsg: null,
    suggested: null,
  };
}

function primaryContactName(contacts: ContactDraft[]): string {
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  if (!primary) return "";
  return [primary.first, primary.last]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

function CreateCustomerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canManage = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );
  const formId = useId();

  const [accountName, setAccountName] = useState("");
  const [accountNameDirty, setAccountNameDirty] = useState(false);
  const [contacts, setContacts] = useState<ContactDraft[]>([
    emptyContact(true),
  ]);
  const [addresses, setAddresses] = useState<AddressDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !canManage) {
      router.replace("/dashboard/customers");
    }
  }, [user, canManage, router]);

  useEffect(() => {
    if (accountNameDirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountName(primaryContactName(contacts));
  }, [contacts, accountNameDirty]);

  function updateContact(key: string, patch: Partial<ContactDraft>) {
    setContacts((list) =>
      list.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    );
  }

  function setPrimaryContact(key: string) {
    setContacts((list) =>
      list.map((c) => ({ ...c, isPrimary: c.key === key })),
    );
  }

  function removeContact(key: string) {
    setContacts((list) => {
      if (list.length <= 1) return list;
      const next = list.filter((c) => c.key !== key);
      if (!next.some((c) => c.isPrimary) && next[0]) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  function updateAddress(key: string, patch: Partial<AddressDraft>) {
    setAddresses((list) =>
      list.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );
  }

  function setPrimaryAddress(key: string) {
    setAddresses((list) =>
      list.map((a) => ({ ...a, isPrimary: a.key === key })),
    );
  }

  function removeAddress(key: string) {
    setAddresses((list) => {
      const next = list.filter((a) => a.key !== key);
      if (next.length > 0 && !next.some((a) => a.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  async function validateAddress(addr: AddressDraft) {
    if (!token) return;
    const street = addr.address.trim();
    if (!street) {
      updateAddress(addr.key, {
        validated: true,
        validating: false,
        validationMsg: null,
        suggested: null,
      });
      return;
    }

    updateAddress(addr.key, {
      validating: true,
      validationMsg: null,
    });

    try {
      const result = await validateCustomerAddress(token, {
        address: street,
        city: addr.city.trim(),
        state: addr.state.trim(),
        zip: addr.zip.trim(),
      });
      if (!result.valid || !result.address) {
        updateAddress(addr.key, {
          validated: false,
          validating: false,
          suggested: null,
          validationMsg: result.message || "Address could not be validated.",
        });
        return;
      }

      const matched = result.address;
      const matchesEntered =
        matched.address.trim().toLowerCase() === street.toLowerCase() &&
        matched.city.trim().toLowerCase() === addr.city.trim().toLowerCase() &&
        matched.state.trim().toLowerCase() ===
          addr.state.trim().toLowerCase() &&
        matched.zip.trim() === addr.zip.trim();

      if (matchesEntered) {
        updateAddress(addr.key, {
          validated: true,
          validating: false,
          suggested: null,
          validationMsg: "Address verified.",
          ...(addr.countyManual
            ? {}
            : { county: matched.county?.trim() || addr.county }),
        });
      } else {
        updateAddress(addr.key, {
          validated: false,
          validating: false,
          suggested: {
            address: matched,
            matchedAddress: result.matchedAddress,
          },
          validationMsg: null,
        });
      }
    } catch (err) {
      updateAddress(addr.key, {
        validated: false,
        validating: false,
        suggested: null,
        validationMsg:
          err instanceof ApiError
            ? err.message
            : "Address validation failed. Try again.",
      });
    }
  }

  const addressValidationKey = addresses
    .map(
      (a) =>
        `${a.key}:${a.address}:${a.city}:${a.state}:${a.zip}:${a.validated}:${Boolean(a.suggested)}`,
    )
    .join("|");

  useEffect(() => {
    if (!token) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const addr of addresses) {
      if (!addr.address.trim()) continue;
      if (addr.validated || addr.suggested || addr.validating) continue;
      timers.push(
        setTimeout(() => {
          void validateAddress(addr);
        }, 700),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, addressValidationKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
    if (
      !primary ||
      (!isValidPhone(primary.phone) && !isValidEmail(primary.email))
    ) {
      setError(
        "Primary contact requires a valid phone number and/or email address.",
      );
      return;
    }

    for (const addr of addresses) {
      if (!addr.address.trim()) {
        setError(
          "Each property needs a street address, or remove the property.",
        );
        return;
      }
      if (!addr.validated) {
        setError(
          "Validate each property address before creating the customer.",
        );
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const { customer } = await createCustomer(token, {
        accountName: accountName.trim(),
        contacts: contacts.map((c) => ({
          first: c.first.trim(),
          last: c.last.trim(),
          phone: c.phone.trim(),
          email: c.email.trim(),
          label: c.label.trim(),
          isPrimary: c.isPrimary,
        })),
        addresses: addresses.map((a) => ({
          label: a.label.trim(),
          address: a.address.trim(),
          city: a.city.trim(),
          state: a.state.trim(),
          zip: a.zip.trim(),
          county: a.county.trim(),
          countyManual: a.countyManual,
          propertyType: a.propertyType,
          isPrimary: a.isPrimary,
          equipment: a.equipment
            .filter(
              (eq) =>
                eq.generatorModel.trim() ||
                eq.serial.trim() ||
                eq.atsSerial.trim(),
            )
            .map((eq) => ({
              generatorModel: eq.generatorModel.trim(),
              serial: eq.serial.trim(),
              atsSerial: eq.atsSerial.trim(),
            })),
        })),
      });
      router.push(`/dashboard/customers/detail?id=${customer._id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create customer.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!user || !canManage) {
    return <div className="py-6 text-sm text-neutral-500">Loading…</div>;
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-brand-orange"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-brand-dark">
          Add Customer
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Build the full customer record. Only a primary contact with a valid
          phone and/or email is required.
        </p>
      </div>

      <form id={formId} onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Customer record name
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Defaults to the primary contact name. Override for businesses or any
            custom account name.
          </p>
          <label className="mt-4 block text-sm font-medium text-brand-dark">
            Account name
            <input
              value={accountName}
              onChange={(e) => {
                setAccountNameDirty(true);
                setAccountName(e.target.value);
              }}
              placeholder="Defaults from primary contact"
              className={inputClass}
            />
          </label>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Contacts
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                Mark one contact as primary. That contact needs a valid phone
                and/or email.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setContacts((list) => [...list, emptyContact()])}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-neutral-50"
            >
              <Plus className="h-4 w-4" />
              Add contact
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {contacts.map((contact, index) => (
              <div
                key={contact.key}
                className="rounded-lg border border-neutral-100 bg-neutral-50/60 p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-brand-dark">
                    <input
                      type="radio"
                      name="primary-contact"
                      checked={contact.isPrimary}
                      onChange={() => setPrimaryContact(contact.key)}
                      className="text-brand-orange focus:ring-brand-orange"
                    />
                    Primary contact
                    {contact.isPrimary ? (
                      <span className="rounded-full bg-brand-dark/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-dark">
                        Required reachability
                      </span>
                    ) : null}
                  </label>
                  {contacts.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeContact(contact.key)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-brand-dark">
                    First name
                    <input
                      value={contact.first}
                      onChange={(e) =>
                        updateContact(contact.key, { first: e.target.value })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm font-medium text-brand-dark">
                    Last name
                    <input
                      value={contact.last}
                      onChange={(e) =>
                        updateContact(contact.key, { last: e.target.value })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm font-medium text-brand-dark">
                    Phone
                    <input
                      type="tel"
                      value={contact.phone}
                      onChange={(e) =>
                        updateContact(contact.key, {
                          phone: formatPhoneInput(e.target.value),
                        })
                      }
                      maxLength={14}
                      placeholder="(386)555-0123"
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm font-medium text-brand-dark">
                    Email
                    <input
                      type="email"
                      value={contact.email}
                      onChange={(e) =>
                        updateContact(contact.key, { email: e.target.value })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm font-medium text-brand-dark sm:col-span-2">
                    Label
                    <input
                      value={contact.label}
                      onChange={(e) =>
                        updateContact(contact.key, { label: e.target.value })
                      }
                      placeholder="e.g. Owner, Spouse, Office"
                      className={inputClass}
                    />
                  </label>
                </div>
                {index === 0 && contacts.length === 1 ? null : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Properties
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                Optional. Add one or more sites with equipment and serial
                numbers.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setAddresses((list) => [
                  ...list,
                  emptyAddress(list.length === 0),
                ])
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-neutral-50"
            >
              <Plus className="h-4 w-4" />
              Add property
            </button>
          </div>

          {addresses.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">
              No properties yet. You can add them later from the customer detail
              page.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {addresses.map((addr) => (
                <div
                  key={addr.key}
                  className="rounded-lg border border-neutral-100 bg-neutral-50/60 p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-brand-dark">
                      <input
                        type="radio"
                        name="primary-address"
                        checked={addr.isPrimary}
                        onChange={() => setPrimaryAddress(addr.key)}
                        className="text-brand-orange focus:ring-brand-orange"
                      />
                      Primary property
                    </label>
                    <button
                      type="button"
                      onClick={() => removeAddress(addr.key)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-brand-dark sm:col-span-2">
                      Label
                      <input
                        value={addr.label}
                        onChange={(e) =>
                          updateAddress(addr.key, { label: e.target.value })
                        }
                        placeholder="e.g. Home, Shop"
                        className={inputClass}
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <span className="block text-sm font-medium text-brand-dark">
                        Property type
                      </span>
                      <div className="mt-1 inline-flex rounded-md border border-neutral-200 bg-white p-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateAddress(addr.key, {
                              propertyType: "residential",
                            })
                          }
                          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                            addr.propertyType === "residential"
                              ? "bg-brand-dark text-white"
                              : "text-neutral-600 hover:bg-neutral-50"
                          }`}
                        >
                          Residential
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateAddress(addr.key, {
                              propertyType: "commercial",
                            })
                          }
                          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                            addr.propertyType === "commercial"
                              ? "bg-brand-dark text-white"
                              : "text-neutral-600 hover:bg-neutral-50"
                          }`}
                        >
                          Commercial
                        </button>
                      </div>
                    </div>
                    <label className="block text-sm font-medium text-brand-dark sm:col-span-2">
                      Street
                      <input
                        value={addr.address}
                        onChange={(e) =>
                          updateAddress(addr.key, {
                            address: e.target.value,
                            validated: false,
                            validationMsg: null,
                            suggested: null,
                          })
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="block text-sm font-medium text-brand-dark">
                      City
                      <input
                        value={addr.city}
                        onChange={(e) =>
                          updateAddress(addr.key, {
                            city: e.target.value,
                            validated: false,
                            validationMsg: null,
                            suggested: null,
                          })
                        }
                        className={inputClass}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm font-medium text-brand-dark">
                        State
                        <input
                          value={addr.state}
                          onChange={(e) =>
                            updateAddress(addr.key, {
                              state: e.target.value,
                              validated: false,
                              validationMsg: null,
                              suggested: null,
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="block text-sm font-medium text-brand-dark">
                        Zip
                        <input
                          value={addr.zip}
                          onChange={(e) =>
                            updateAddress(addr.key, {
                              zip: e.target.value,
                              validated: false,
                              validationMsg: null,
                              suggested: null,
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                    </div>
                    <label className="block text-sm font-medium text-brand-dark sm:col-span-2">
                      County{" "}
                      <span className="font-normal text-neutral-500">
                        (auto-filled; override if needed)
                      </span>
                      <select
                        value={
                          FLORIDA_COUNTIES.includes(
                            addr.county as (typeof FLORIDA_COUNTIES)[number],
                          )
                            ? addr.county
                            : addr.county
                              ? "__other__"
                              : ""
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__other__") {
                            updateAddress(addr.key, {
                              county: addr.county || "",
                              countyManual: true,
                            });
                            return;
                          }
                          updateAddress(addr.key, {
                            county: v,
                            countyManual: Boolean(v),
                          });
                        }}
                        className={inputClass}
                      >
                        <option value="">Select county…</option>
                        {FLORIDA_COUNTIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        {addr.county &&
                        !FLORIDA_COUNTIES.includes(
                          addr.county as (typeof FLORIDA_COUNTIES)[number],
                        ) ? (
                          <option value="__other__">{addr.county}</option>
                        ) : null}
                      </select>
                      {addr.county &&
                      !FLORIDA_COUNTIES.includes(
                        addr.county as (typeof FLORIDA_COUNTIES)[number],
                      ) ? (
                        <input
                          value={addr.county}
                          onChange={(e) =>
                            updateAddress(addr.key, {
                              county: e.target.value,
                              countyManual: true,
                            })
                          }
                          className={inputClass}
                          placeholder="County name"
                        />
                      ) : null}
                    </label>
                  </div>

                  <div className="mt-3 space-y-2">
                    {addr.validating ? (
                      <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Validating address…
                      </p>
                    ) : null}
                    {addr.validationMsg ? (
                      <p
                        className={`text-xs ${
                          addr.validated ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        {addr.validationMsg}
                      </p>
                    ) : null}
                    {addr.suggested ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <p>
                          Suggested:{" "}
                          {[
                            addr.suggested.address.address,
                            addr.suggested.address.city,
                            addr.suggested.address.state,
                            addr.suggested.address.zip,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const matched = addr.suggested!.address;
                              updateAddress(addr.key, {
                                address: matched.address,
                                city: matched.city,
                                state: matched.state,
                                zip: matched.zip,
                                county: addr.countyManual
                                  ? addr.county
                                  : matched.county?.trim() || addr.county,
                                validated: true,
                                suggested: null,
                                validationMsg: addr.suggested!.matchedAddress
                                  ? `Matched: ${addr.suggested!.matchedAddress}`
                                  : "Address validated.",
                              });
                            }}
                            className="rounded-md bg-brand-dark px-2.5 py-1 text-xs font-medium text-white"
                          >
                            Accept suggestion
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateAddress(addr.key, {
                                validated: true,
                                suggested: null,
                                validationMsg: "Using address as entered.",
                              })
                            }
                            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-dark"
                          >
                            Keep as entered
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 border-t border-neutral-200 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-brand-dark">
                        Equipment
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          updateAddress(addr.key, {
                            equipment: [...addr.equipment, emptyEquipment()],
                          })
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-dark hover:underline"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add equipment
                      </button>
                    </div>
                    {addr.equipment.length === 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">
                        No equipment on this property yet.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {addr.equipment.map((eq) => (
                          <div
                            key={eq.key}
                            className="grid grid-cols-1 gap-3 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-3"
                          >
                            <label className="block text-xs font-medium text-brand-dark">
                              Generator model
                              <input
                                value={eq.generatorModel}
                                onChange={(e) =>
                                  updateAddress(addr.key, {
                                    equipment: addr.equipment.map((row) =>
                                      row.key === eq.key
                                        ? {
                                            ...row,
                                            generatorModel: e.target.value,
                                          }
                                        : row,
                                    ),
                                  })
                                }
                                className={inputClass}
                              />
                            </label>
                            <label className="block text-xs font-medium text-brand-dark">
                              Serial number
                              <input
                                value={eq.serial}
                                onChange={(e) =>
                                  updateAddress(addr.key, {
                                    equipment: addr.equipment.map((row) =>
                                      row.key === eq.key
                                        ? { ...row, serial: e.target.value }
                                        : row,
                                    ),
                                  })
                                }
                                className={inputClass}
                              />
                            </label>
                            <div className="flex items-end gap-2">
                              <label className="block flex-1 text-xs font-medium text-brand-dark">
                                ATS serial
                                <input
                                  value={eq.atsSerial}
                                  onChange={(e) =>
                                    updateAddress(addr.key, {
                                      equipment: addr.equipment.map((row) =>
                                        row.key === eq.key
                                          ? {
                                              ...row,
                                              atsSerial: e.target.value,
                                            }
                                          : row,
                                      ),
                                    })
                                  }
                                  className={inputClass}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  updateAddress(addr.key, {
                                    equipment: addr.equipment.filter(
                                      (row) => row.key !== eq.key,
                                    ),
                                  })
                                }
                                className="mb-0.5 rounded p-2 text-red-600 hover:bg-red-50"
                                aria-label="Remove equipment"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col-reverse gap-2 pb-8 sm:flex-row sm:flex-wrap sm:justify-end">
          <Link
            href={returnTo}
            className="inline-flex items-center justify-center rounded-md border border-neutral-200 px-4 py-2.5 text-sm font-medium text-brand-dark hover:bg-neutral-50 sm:py-2"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || addresses.some((a) => a.validating)}
            className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:opacity-60 sm:py-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create customer"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CreateCustomerPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={<div className="py-6 text-sm text-neutral-500">Loading…</div>}
      >
        <CreateCustomerContent />
      </Suspense>
    </AuthGuard>
  );
}
