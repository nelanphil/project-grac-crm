"use client";

import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useState,
} from "react";
import { Loader2, MapPin, Plus, Wrench } from "lucide-react";
import {
  ApiError,
  CustomerAddress,
  CustomerEquipment,
  SerialConflict,
  checkEquipmentSerial,
  createCustomerAddress,
  createCustomerEquipment,
  updateCustomerAddress,
  validateCustomerAddress,
} from "@/lib/api";
import { FLORIDA_COUNTIES } from "@/lib/floridaCounties";

type AddressFormState = {
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  propertyType: "residential" | "commercial";
  isPrimary: boolean;
};

const emptyAddrForm = (): AddressFormState => ({
  label: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  county: "",
  propertyType: "residential",
  isPrimary: false,
});

function formFromAddress(addr: CustomerAddress): AddressFormState {
  return {
    label: addr.label ?? "",
    address: addr.address ?? "",
    city: addr.city ?? "",
    state: addr.state ?? "",
    zip: addr.zip ?? "",
    county: addr.county ?? "",
    propertyType: addr.propertyType === "commercial" ? "commercial" : "residential",
    isPrimary: Boolean(addr.isPrimary),
  };
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

function formatAddressLine(addr: CustomerAddress): string {
  return (
    [addr.address, addr.city, addr.county, addr.state, addr.zip]
      .filter(Boolean)
      .join(", ") || "—"
  );
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingEquipmentFor, setAddingEquipmentFor] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addrForm, setAddrForm] = useState<AddressFormState>(emptyAddrForm);

  const [eqForm, setEqForm] = useState({
    generatorModel: "",
    serial: "",
    atsSerial: "",
    exday: "",
    extime: "",
  });

  const [serialCheck, setSerialCheck] = useState<{
    blocking: SerialConflict[];
    warnings: SerialConflict[];
  }>({ blocking: [], warnings: [] });
  const [checkingSerial, setCheckingSerial] = useState(false);

  async function runSerialCheck(next: { serial: string; atsSerial: string }) {
    const serial = next.serial.trim();
    const atsSerial = next.atsSerial.trim();
    if (!serial && !atsSerial) {
      setSerialCheck({ blocking: [], warnings: [] });
      return;
    }
    setCheckingSerial(true);
    try {
      const res = await checkEquipmentSerial(token, customerId, {
        serial,
        atsSerial,
      });
      setSerialCheck(res);
    } catch {
      // Non-fatal: the server still enforces uniqueness on submit.
      setSerialCheck({ blocking: [], warnings: [] });
    } finally {
      setCheckingSerial(false);
    }
  }

  function openEquipmentForm(addressId: string | null) {
    setAddingEquipmentFor(addressId);
    setEditingId(null);
    setAddingAddress(false);
    setSerialCheck({ blocking: [], warnings: [] });
    setError(null);
  }

  function startAddAddress() {
    setAddingAddress(true);
    setEditingId(null);
    setAddingEquipmentFor(null);
    setAddrForm({ ...emptyAddrForm(), isPrimary: addresses.length === 0 });
    setError(null);
  }

  function startEditAddress(addr: CustomerAddress) {
    setEditingId(addr._id);
    setAddingAddress(false);
    setAddingEquipmentFor(null);
    setAddrForm(formFromAddress(addr));
    setError(null);
  }

  function cancelAddressForm() {
    setAddingAddress(false);
    setEditingId(null);
    setAddrForm(emptyAddrForm());
    setError(null);
  }

  function applyUpdatedAddress(updated: CustomerAddress) {
    onAddressesChange(
      addresses.map((addr) => {
        if (addr._id === updated._id) {
          return {
            ...updated,
            equipment: updated.equipment ?? addr.equipment,
          };
        }
        if (updated.isPrimary) {
          return { ...addr, isPrimary: false };
        }
        return addr;
      }),
    );
  }

  async function handleAddAddress(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { address } = await createCustomerAddress(token, customerId, {
        label: addrForm.label,
        address: addrForm.address,
        city: addrForm.city,
        state: addrForm.state,
        zip: addrForm.zip,
        county: addrForm.county,
        countyManual: Boolean(addrForm.county.trim()),
        propertyType: addrForm.propertyType,
        isPrimary: addresses.length === 0 || addrForm.isPrimary,
      });
      const next = [
        ...addresses.map((a) =>
          address.isPrimary ? { ...a, isPrimary: false } : a,
        ),
        { ...address, equipment: address.equipment ?? [] },
      ];
      onAddressesChange(next);
      cancelAddressForm();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to add address.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateAddress(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const { address } = await updateCustomerAddress(
        token,
        customerId,
        editingId,
        {
          label: addrForm.label,
          address: addrForm.address,
          city: addrForm.city,
          state: addrForm.state,
          zip: addrForm.zip,
          county: addrForm.county,
          countyManual: Boolean(addrForm.county.trim()),
          propertyType: addrForm.propertyType,
          isPrimary: addrForm.isPrimary,
        },
      );
      applyUpdatedAddress(address);
      cancelAddressForm();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update address.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPrimary(addressId: string) {
    setSaving(true);
    setError(null);
    try {
      const { address } = await updateCustomerAddress(
        token,
        customerId,
        addressId,
        { isPrimary: true },
      );
      applyUpdatedAddress(address);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to set primary address.",
      );
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
            : addr,
        ),
      );
      setEqForm({
        generatorModel: "",
        serial: "",
        atsSerial: "",
        exday: "",
        extime: "",
      });
      setSerialCheck({ blocking: [], warnings: [] });
      setAddingEquipmentFor(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to add equipment.",
      );
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
          <p className="text-sm font-medium text-neutral-500">
            No addresses yet
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Add an address to attach equipment for this customer.
          </p>
          {canWrite ? (
            <button
              type="button"
              onClick={startAddAddress}
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
                <span
                  className={
                    addr.propertyType === "commercial"
                      ? "rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
                      : "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                  }
                >
                  {addr.propertyType === "commercial"
                    ? "Commercial"
                    : "Residential"}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                {formatAddressLine(addr)}
              </p>
            </div>
            {canWrite ? (
              <div className="flex flex-wrap gap-3 text-xs">
                {!addr.isPrimary ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSetPrimary(addr._id)}
                    className="font-medium text-brand-orange hover:underline disabled:opacity-50"
                  >
                    Set primary
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    editingId === addr._id
                      ? cancelAddressForm()
                      : startEditAddress(addr)
                  }
                  className="font-medium text-neutral-600 hover:underline disabled:opacity-50"
                >
                  {editingId === addr._id ? "Cancel" : "Edit"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    openEquipmentForm(
                      addingEquipmentFor === addr._id ? null : addr._id,
                    )
                  }
                  className="inline-flex items-center gap-1 font-medium text-brand-orange hover:underline disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add equipment
                </button>
              </div>
            ) : null}
          </div>

          {editingId === addr._id ? (
            <AddressFormFields
              title="Edit address"
              token={token}
              form={addrForm}
              setForm={setAddrForm}
              saving={saving}
              showPrimaryToggle={addresses.length > 1}
              onCancel={cancelAddressForm}
              onSubmit={handleUpdateAddress}
              submitLabel="Save address"
            />
          ) : null}

          {addr.equipment.length === 0 &&
          addingEquipmentFor !== addr._id &&
          editingId !== addr._id ? (
            <p className="text-xs text-neutral-400">
              No equipment at this address.
            </p>
          ) : addr.equipment.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Equipment ({addr.equipment.length})
              </p>
              <ul className="space-y-3">
                {addr.equipment.map((eq) => (
                  <EquipmentCard key={eq._id} equipment={eq} />
                ))}
              </ul>
            </div>
          ) : null}

          {addingEquipmentFor === addr._id ? (
            <form
              onSubmit={(e) => handleAddEquipment(e, addr._id)}
              className="mt-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                New equipment at this address
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Generator model"
                  value={eqForm.generatorModel}
                  onChange={(v) =>
                    setEqForm((f) => ({ ...f, generatorModel: v }))
                  }
                />
                <Field
                  label="Serial"
                  value={eqForm.serial}
                  onChange={(v) => setEqForm((f) => ({ ...f, serial: v }))}
                  onBlur={() => runSerialCheck(eqForm)}
                />
                <Field
                  label="ATS serial"
                  value={eqForm.atsSerial}
                  onChange={(v) => setEqForm((f) => ({ ...f, atsSerial: v }))}
                  onBlur={() => runSerialCheck(eqForm)}
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

              {serialCheck.blocking.length > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {serialCheck.blocking.map((c, i) => (
                    <p key={`${c.equipmentId}-${c.field}-${i}`}>
                      {c.field === "atsSerial" ? "ATS serial" : "Serial"}{" "}
                      &ldquo;
                      {c.value}&rdquo; is already on{" "}
                      {c.addressLabel
                        ? `“${c.addressLabel}”`
                        : "another address"}{" "}
                      for this customer. A serial can only be used on one
                      address.
                    </p>
                  ))}
                </div>
              ) : null}

              {serialCheck.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {serialCheck.warnings.map((c, i) => (
                    <p key={`${c.equipmentId}-${c.field}-${i}`}>
                      Possible duplicate:{" "}
                      {c.field === "atsSerial" ? "ATS serial" : "Serial"}{" "}
                      &ldquo;
                      {c.value}&rdquo; is also used by{" "}
                      {c.customerName ?? "another customer"}.
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => openEquipmentForm(null)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    saving || checkingSerial || serialCheck.blocking.length > 0
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-orange/90 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Save equipment
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ))}

      {addingAddress ? (
        <AddressFormFields
          title="New address"
          token={token}
          form={addrForm}
          setForm={setAddrForm}
          saving={saving}
          showPrimaryToggle={addresses.length > 0}
          onCancel={cancelAddressForm}
          onSubmit={handleAddAddress}
          submitLabel="Save address"
          className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
        />
      ) : canWrite && !editingId ? (
        <button
          type="button"
          onClick={startAddAddress}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add address
        </button>
      ) : null}
    </div>
  );
}

function AddressFormFields({
  title,
  token,
  form,
  setForm,
  saving,
  showPrimaryToggle,
  onCancel,
  onSubmit,
  submitLabel,
  className = "mt-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4",
}: {
  title: string;
  token: string;
  form: AddressFormState;
  setForm: Dispatch<SetStateAction<AddressFormState>>;
  saving: boolean;
  showPrimaryToggle: boolean;
  onCancel: () => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  className?: string;
}) {
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function handleLookupZipCounty() {
    const street = form.address.trim();
    const state = form.state.trim();
    if (!street || !state) {
      setLookupError("Street and state are required for lookup.");
      setLookupMsg(null);
      return;
    }

    setLookingUp(true);
    setLookupError(null);
    setLookupMsg(null);
    try {
      const result = await validateCustomerAddress(token, {
        address: street,
        city: form.city.trim(),
        state,
        zip: form.zip.trim(),
      });
      if (!result.valid || !result.address) {
        setLookupError(
          result.message || "Could not find a ZIP or county for this address.",
        );
        return;
      }

      const zip = result.address.zip?.trim() ?? "";
      const county = result.address.county?.trim() ?? "";
      setForm((f) => ({
        ...f,
        ...(zip ? { zip } : {}),
        ...(county ? { county } : {}),
      }));
      setLookupMsg(
        result.matchedAddress
          ? `Matched: ${result.matchedAddress}`
          : "ZIP and county updated from lookup.",
      );
    } catch (err) {
      setLookupError(
        err instanceof ApiError
          ? err.message
          : "Address lookup failed. Try again.",
      );
    } finally {
      setLookingUp(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <p className="text-sm font-semibold text-brand-dark">{title}</p>
      <div>
        <span className="mb-1 block text-xs font-medium text-neutral-500">
          Property type
        </span>
        <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({ ...f, propertyType: "residential" }))
            }
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              form.propertyType === "residential"
                ? "bg-brand-dark text-white"
                : "text-neutral-600 hover:bg-white"
            }`}
          >
            Residential
          </button>
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({ ...f, propertyType: "commercial" }))
            }
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              form.propertyType === "commercial"
                ? "bg-brand-dark text-white"
                : "text-neutral-600 hover:bg-white"
            }`}
          >
            Commercial
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Label"
          value={form.label}
          onChange={(v) => setForm((f) => ({ ...f, label: v }))}
          placeholder="e.g. Ormond Beach"
        />
        <Field
          label="Street"
          value={form.address}
          onChange={(v) => setForm((f) => ({ ...f, address: v }))}
        />
        <Field
          label="City"
          value={form.city}
          onChange={(v) => setForm((f) => ({ ...f, city: v }))}
        />
        <Field
          label="State"
          value={form.state}
          onChange={(v) => setForm((f) => ({ ...f, state: v }))}
        />
        <Field
          label="Zip"
          value={form.zip}
          onChange={(v) => setForm((f) => ({ ...f, zip: v }))}
        />
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">
            County
          </label>
          <select
            value={
              form.county &&
              !(FLORIDA_COUNTIES as readonly string[]).includes(form.county)
                ? "__other__"
                : form.county
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__other__") return;
              setForm((f) => ({ ...f, county: v }));
            }}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          >
            <option value="">Select county…</option>
            {FLORIDA_COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {form.county &&
            !(FLORIDA_COUNTIES as readonly string[]).includes(form.county) ? (
              <option value="__other__">{form.county}</option>
            ) : null}
          </select>
          {form.county &&
          !(FLORIDA_COUNTIES as readonly string[]).includes(form.county) ? (
            <input
              type="text"
              value={form.county}
              onChange={(e) =>
                setForm((f) => ({ ...f, county: e.target.value }))
              }
              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              placeholder="County name"
            />
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <button
          type="button"
          disabled={lookingUp || saving}
          onClick={handleLookupZipCounty}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange hover:underline disabled:opacity-50"
        >
          {lookingUp ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Lookup ZIP / county
        </button>
        {lookupMsg ? (
          <p className="text-xs text-emerald-700">{lookupMsg}</p>
        ) : null}
        {lookupError ? (
          <p className="text-xs text-red-600">{lookupError}</p>
        ) : null}
      </div>
      {showPrimaryToggle ? (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={form.isPrimary}
            onChange={(e) =>
              setForm((f) => ({ ...f, isPrimary: e.target.checked }))
            }
            className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
          />
          Primary address
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
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
          {submitLabel}
        </button>
      </div>
    </form>
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
          <dt className="text-xs uppercase tracking-wide text-neutral-400">
            Serial
          </dt>
          <dd className="text-neutral-700">{eq.serial || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">
            ATS Serial
          </dt>
          <dd className="text-neutral-700">{eq.atsSerial || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">
            Last Service
          </dt>
          <dd className="text-neutral-700">{formatDate(eq.lastSvc)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">
            Exercise Day
          </dt>
          <dd className="text-neutral-700">{eq.exday || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-400">
            Exercise Time
          </dt>
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
  onBlur,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
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
        onBlur={onBlur}
        className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
      />
    </label>
  );
}

export function formatAddressLabel(
  addr:
    | {
        label?: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
      }
    | null
    | undefined,
): string {
  if (!addr) return "—";
  if (addr.label?.trim()) return addr.label.trim();
  const line = [addr.address, addr.city, addr.state, addr.zip]
    .filter(Boolean)
    .join(", ");
  return line || "—";
}
