"use client";

import { FormEvent, useState } from "react";
import { Loader2, MapPin, Plus, Wrench } from "lucide-react";
import {
  ApiError,
  CustomerAddress,
  CustomerEquipment,
  createCustomerAddress,
  createCustomerEquipment,
} from "@/lib/api";

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

function formatAddressLine(addr: CustomerAddress): string {
  return [addr.address, addr.city, addr.state, addr.zip].filter(Boolean).join(", ") || "—";
}

export function addressesSectionTitle(): string {
  return "Address";
}

interface CustomerAddressesPanelProps {
  customerId: string;
  token: string;
  addresses: CustomerAddress[];
  canWrite?: boolean;
  onAddressesChange: (addresses: CustomerAddress[]) => void;
}

export default function CustomerAddressesPanel({
  customerId,
  token,
  addresses,
  canWrite = false,
  onAddressesChange,
}: CustomerAddressesPanelProps) {
  const [addingAddress, setAddingAddress] = useState(false);
  const [addingEquipmentFor, setAddingEquipmentFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addrForm, setAddrForm] = useState({
    label: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });

  const [eqForm, setEqForm] = useState({
    generatorModel: "",
    serial: "",
    atsSerial: "",
    exday: "",
    extime: "",
  });

  async function handleAddAddress(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { address } = await createCustomerAddress(token, customerId, {
        ...addrForm,
        isPrimary: addresses.length === 0,
      });
      onAddressesChange([...addresses, { ...address, equipment: address.equipment ?? [] }]);
      setAddrForm({ label: "", address: "", city: "", state: "", zip: "" });
      setAddingAddress(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add address.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddEquipment(e: FormEvent, addressId: string) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { equipment } = await createCustomerEquipment(token, customerId, {
        addressRef: addressId,
        ...eqForm,
      });
      onAddressesChange(
        addresses.map((addr) =>
          addr._id === addressId
            ? { ...addr, equipment: [...addr.equipment, equipment] }
            : addr
        )
      );
      setEqForm({
        generatorModel: "",
        serial: "",
        atsSerial: "",
        exday: "",
        extime: "",
      });
      setAddingEquipmentFor(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add equipment.");
    } finally {
      setSaving(false);
    }
  }

  if (addresses.length === 0 && !addingAddress) {
    return (
      <div className="space-y-3">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white py-10 text-center shadow-sm">
          <MapPin className="mx-auto mb-3 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-500">No addresses yet</p>
          <p className="mt-1 text-xs text-neutral-400">
            Add an address to attach equipment for this customer.
          </p>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setAddingAddress(true)}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline"
            >
              <Plus className="h-4 w-4" />
              Add address
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {addresses.map((addr) => (
        <div
          key={addr._id}
          className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-brand-orange" />
                <h3 className="text-base font-semibold text-brand-dark">
                  {addr.label || addr.city || "Address"}
                </h3>
                {addr.isPrimary ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300">
                    Primary
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-neutral-600">{formatAddressLine(addr)}</p>
            </div>
            {canWrite ? (
              <button
                type="button"
                onClick={() => {
                  setAddingEquipmentFor(
                    addingEquipmentFor === addr._id ? null : addr._id
                  );
                  setError(null);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-orange hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                Add equipment
              </button>
            ) : null}
          </div>

          {addr.equipment.length === 0 && addingEquipmentFor !== addr._id ? (
            <p className="text-xs text-neutral-400">No equipment at this address.</p>
          ) : (
            <ul className="space-y-3">
              {addr.equipment.map((eq) => (
                <EquipmentCard key={eq._id} equipment={eq} />
              ))}
            </ul>
          )}

          {addingEquipmentFor === addr._id ? (
            <form
              onSubmit={(e) => handleAddEquipment(e, addr._id)}
              className="mt-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                New equipment at this address
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Generator model"
                  value={eqForm.generatorModel}
                  onChange={(v) => setEqForm((f) => ({ ...f, generatorModel: v }))}
                />
                <Field
                  label="Serial"
                  value={eqForm.serial}
                  onChange={(v) => setEqForm((f) => ({ ...f, serial: v }))}
                />
                <Field
                  label="ATS serial"
                  value={eqForm.atsSerial}
                  onChange={(v) => setEqForm((f) => ({ ...f, atsSerial: v }))}
                />
                <Field
                  label="Exercise day"
                  value={eqForm.exday}
                  onChange={(v) => setEqForm((f) => ({ ...f, exday: v }))}
                />
                <Field
                  label="Exercise time"
                  value={eqForm.extime}
                  onChange={(v) => setEqForm((f) => ({ ...f, extime: v }))}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingEquipmentFor(null)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save equipment
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ))}

      {addingAddress ? (
        <form
          onSubmit={handleAddAddress}
          className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <p className="text-sm font-semibold text-brand-dark">New address</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Label"
              value={addrForm.label}
              onChange={(v) => setAddrForm((f) => ({ ...f, label: v }))}
              placeholder="e.g. Ormond Beach"
            />
            <Field
              label="Street"
              value={addrForm.address}
              onChange={(v) => setAddrForm((f) => ({ ...f, address: v }))}
            />
            <Field
              label="City"
              value={addrForm.city}
              onChange={(v) => setAddrForm((f) => ({ ...f, city: v }))}
            />
            <Field
              label="State"
              value={addrForm.state}
              onChange={(v) => setAddrForm((f) => ({ ...f, state: v }))}
            />
            <Field
              label="Zip"
              value={addrForm.zip}
              onChange={(v) => setAddrForm((f) => ({ ...f, zip: v }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddingAddress(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save address
            </button>
          </div>
        </form>
      ) : canWrite ? (
        <button
          type="button"
          onClick={() => {
            setAddingAddress(true);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add address
        </button>
      ) : null}
    </div>
  );
}

function EquipmentCard({ equipment: eq }: { equipment: CustomerEquipment }) {
  return (
    <li className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-brand-dark">
        <Wrench className="h-3.5 w-3.5 text-neutral-400" />
        {eq.generatorModel || "Generator"}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">Serial</dt>
          <dd className="text-neutral-700">{eq.serial || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">ATS Serial</dt>
          <dd className="text-neutral-700">{eq.atsSerial || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">Last Service</dt>
          <dd className="text-neutral-700">{formatDate(eq.lastSvc)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">Exercise Day</dt>
          <dd className="text-neutral-700">{eq.exday || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">Exercise Time</dt>
          <dd className="text-neutral-700">{eq.extime || "—"}</dd>
        </div>
      </dl>
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-neutral-500">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
      />
    </label>
  );
}

export function formatAddressLabel(addr: {
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
} | null | undefined): string {
  if (!addr) return "—";
  if (addr.label?.trim()) return addr.label.trim();
  const line = [addr.address, addr.city, addr.state, addr.zip].filter(Boolean).join(", ");
  return line || "—";
}
