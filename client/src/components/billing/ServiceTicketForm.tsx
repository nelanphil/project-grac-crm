"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CustomerDetail,
  CustomerListItem,
  ProductItem,
  getCustomer,
  getCustomers,
  getProducts,
} from "@/lib/api";
import { COMPANY } from "@/lib/constants";
import { formatCustomerRecordName } from "@/lib/formatName";
import {
  SERVICE_TICKET_TERMS,
  TicketFormState,
  TicketVariant,
  defaultLaborTotal,
  emptyTicketForm,
  parseMoney,
  partAmount,
  ticketToPayload,
  ticketTotals,
} from "@/lib/service-ticket";
import { useAuthStore } from "@/store/useAuthStore";
import SignaturePad from "@/components/billing/SignaturePad";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className ?? ""}`}>
      <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

export default function ServiceTicketForm({
  variant,
  initial,
  submitting,
  submitLabel,
  onSubmit,
  extraActions,
}: {
  variant: TicketVariant;
  initial?: TicketFormState;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (payload: ReturnType<typeof ticketToPayload>) => void | Promise<void>;
  extraActions?: React.ReactNode;
}) {
  const token = useAuthStore((s) => s.token);
  const [form, setForm] = useState<TicketFormState>(initial ?? emptyTicketForm());
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerListItem[]>([]);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [productQuery, setProductQuery] = useState<Record<number, string>>({});
  const [productResults, setProductResults] = useState<ProductItem[]>([]);
  const [activePartIndex, setActivePartIndex] = useState<number | null>(null);

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  useEffect(() => {
    if (!token || !form.customerRef) return;
    getCustomer(token, form.customerRef)
      .then(({ customer: c }) => {
        setCustomer(c);
        setForm((prev) => {
          if (prev.addressRef || c.addresses.length === 0) return prev;
          const site = c.addresses.find((a) => a.isPrimary) ?? c.addresses[0];
          const equipment = site.equipment?.[0];
          return {
            ...prev,
            addressRef: site._id,
            customerAddress: prev.customerAddress || site.address,
            customerCity: prev.customerCity || site.city,
            customerZip: prev.customerZip || site.zip,
            equipmentRef: equipment?._id ?? prev.equipmentRef,
            serialNumber: prev.serialNumber || equipment?.serial || c.serial,
            generatorModel:
              prev.generatorModel || equipment?.generatorModel || c.generatorModel,
            exerciseDay: prev.exerciseDay || equipment?.exday || c.exday,
            exerciseTime: prev.exerciseTime || equipment?.extime || c.extime,
          };
        });
      })
      .catch(() => setCustomer(null));
  }, [token, form.customerRef]);

  useEffect(() => {
    if (!token || customerQuery.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    const t = setTimeout(() => {
      getCustomers(token, { search: customerQuery.trim(), pageSize: 8 })
        .then((res) => setCustomerResults(res.customers))
        .catch(() => setCustomerResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [token, customerQuery]);

  useEffect(() => {
    if (!token || activePartIndex == null) return;
    const q = (productQuery[activePartIndex] ?? "").trim();
    if (q.length < 1) {
      setProductResults([]);
      return;
    }
    const t = setTimeout(() => {
      getProducts(token, { search: q, active: true })
        .then(({ products }) => setProductResults(products.slice(0, 8)))
        .catch(() => setProductResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [token, activePartIndex, productQuery]);

  const totals = useMemo(() => ticketTotals(form), [form]);
  const computedLabor = defaultLaborTotal(parseMoney(form.laborHours));

  function patch(partial: Partial<TicketFormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function applyCustomer(c: CustomerListItem | CustomerDetail) {
    const addresses = "addresses" in c ? c.addresses : [];
    const primary = addresses.find((a) => a.isPrimary) ?? addresses[0];
    const equipment = primary?.equipment?.[0];
    patch({
      customerRef: c._id,
      customerId: c.legacyId,
      customerName: formatCustomerRecordName(c),
      customerAddress: primary?.address ?? c.address,
      customerCity: primary?.city ?? c.city,
      customerZip: primary?.zip ?? c.zip,
      customerPhone: c.phone,
      customerEmail: c.email,
      addressRef: primary?._id ?? "",
      equipmentRef: equipment?._id ?? "",
      serialNumber: equipment?.serial ?? ("serial" in c ? c.serial : ""),
      generatorModel: equipment?.generatorModel ?? c.generatorModel,
      exerciseDay: equipment?.exday ?? ("exday" in c ? c.exday : ""),
      exerciseTime: equipment?.extime ?? ("extime" in c ? c.extime : ""),
    });
    setCustomerQuery("");
    setCustomerResults([]);
    if ("addresses" in c) setCustomer(c);
  }

  function applyAddress(addressId: string) {
    const site = customer?.addresses.find((a) => a._id === addressId);
    const equipment = site?.equipment?.[0];
    patch({
      addressRef: addressId,
      customerAddress: site?.address ?? form.customerAddress,
      customerCity: site?.city ?? form.customerCity,
      customerZip: site?.zip ?? form.customerZip,
      equipmentRef: equipment?._id ?? "",
      serialNumber: equipment?.serial ?? form.serialNumber,
      generatorModel: equipment?.generatorModel ?? form.generatorModel,
      exerciseDay: equipment?.exday ?? form.exerciseDay,
      exerciseTime: equipment?.extime ?? form.exerciseTime,
    });
  }

  function applyEquipment(equipmentId: string) {
    const units = customer?.addresses.flatMap((a) => a.equipment) ?? [];
    const unit = units.find((e) => e._id === equipmentId);
    patch({
      equipmentRef: equipmentId,
      serialNumber: unit?.serial ?? "",
      generatorModel: unit?.generatorModel ?? "",
      exerciseDay: unit?.exday ?? "",
      exerciseTime: unit?.extime ?? "",
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.customerId) return;
    await onSubmit(ticketToPayload(form));
  }

  const equipmentOptions =
    customer?.addresses.find((a) => a._id === form.addressRef)?.equipment ??
    customer?.addresses.flatMap((a) => a.equipment) ??
    [];

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
      <article className="rounded-xl border border-neutral-200 bg-white px-4 py-6 shadow-sm sm:px-8">
        <header className="border-b border-neutral-200 pb-5 text-center">
          <p className="text-3xl font-black tracking-[0.2em] text-brand-dark">
            GENERAC
          </p>
          <p className="mt-1 text-lg font-semibold text-brand-dark">{COMPANY.name}</p>
          <p className="text-xs text-neutral-500">
            Authorized Dealer · Certified Technicians · Sales · Service · Installation
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {COMPANY.phone} · {COMPANY.email}
          </p>
        </header>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={variant === "estimate" ? "Estimate No" : "Work Order No"}>
            <input value={form.number || "Assigned on save"} disabled className={inputClass} />
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={form.date}
              onChange={(e) => patch({ date: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Tech">
            <input
              value={form.tech}
              onChange={(e) => patch({ tech: e.target.value })}
              className={inputClass}
            />
          </Field>
          {variant === "estimate" ? (
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) =>
                  patch({ status: e.target.value as TicketFormState["status"] })
                }
                className={inputClass}
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
              </select>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Exercise Day">
                <input
                  value={form.exerciseDay}
                  onChange={(e) => patch({ exerciseDay: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Time Set">
                <input
                  value={form.exerciseTime}
                  onChange={(e) => patch({ exerciseTime: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="relative mt-4">
          <Field label="Customer">
            <input
              value={customerQuery || form.customerName}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                if (form.customerName) patch({ customerName: e.target.value });
              }}
              placeholder="Search customers"
              className={inputClass}
            />
          </Field>
          {customerResults.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
              {customerResults.map((c) => (
                <li key={c._id}>
                  <button
                    type="button"
                    onClick={() => applyCustomer(c)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span className="font-medium text-brand-dark">
                      {formatCustomerRecordName(c)}
                    </span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      {c.address} {c.city}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {customer && customer.addresses.length > 1 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Service address">
              <select
                value={form.addressRef}
                onChange={(e) => applyAddress(e.target.value)}
                className={inputClass}
              >
                {customer.addresses.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.label || a.address}
                  </option>
                ))}
              </select>
            </Field>
            {equipmentOptions.length > 0 ? (
              <Field label="Equipment">
                <select
                  value={form.equipmentRef}
                  onChange={(e) => applyEquipment(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select equipment</option>
                  {equipmentOptions.map((unit) => (
                    <option key={unit._id} value={unit._id}>
                      {unit.generatorModel || "Generator"} {unit.serial}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name">
            <input
              value={form.customerName}
              onChange={(e) => patch({ customerName: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Address" className="lg:col-span-2">
            <input
              value={form.customerAddress}
              onChange={(e) => patch({ customerAddress: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="City">
            <input
              value={form.customerCity}
              onChange={(e) => patch({ customerCity: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="ZIP">
            <input
              value={form.customerZip}
              onChange={(e) => patch({ customerZip: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.customerPhone}
              onChange={(e) => patch({ customerPhone: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              value={form.customerEmail}
              onChange={(e) => patch({ customerEmail: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Work phone">
            <input
              value={form.workPhone}
              onChange={(e) => patch({ workPhone: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Serial number">
            <input
              value={form.serialNumber}
              onChange={(e) => patch({ serialNumber: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Model">
            <input
              value={form.generatorModel}
              onChange={(e) => patch({ generatorModel: e.target.value })}
              className={inputClass}
            />
          </Field>
          {variant === "work-order" ? (
            <>
              <Field label="Paid">
                <div className="flex h-[34px] items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      checked={form.paid}
                      onChange={() => patch({ paid: true })}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      checked={!form.paid}
                      onChange={() => patch({ paid: false })}
                    />
                    No
                  </label>
                </div>
              </Field>
              <Field label="Run hours">
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.runHours}
                  onChange={(e) => patch({ runHours: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Exercise Day">
                <input
                  value={form.exerciseDay}
                  onChange={(e) => patch({ exerciseDay: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Time Set">
                <input
                  value={form.exerciseTime}
                  onChange={(e) => patch({ exerciseTime: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
          <Field label="Labor hours">
            <input
              type="number"
              min={0}
              step="0.25"
              value={form.laborHours}
              onChange={(e) =>
                patch({
                  laborHours: e.target.value,
                  laborOverridden: false,
                })
              }
              className={inputClass}
            />
          </Field>
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          Each service includes up to 30 minutes of labor. Each additional 30 minutes
          will incur a $75 charge.
        </p>

        <div className="mt-4">
          <Field label="Description of work to be performed">
            <textarea
              rows={3}
              value={form.descPerform}
              onChange={(e) => patch({ descPerform: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Parts
            </p>
            <div className="overflow-x-auto rounded border border-neutral-200">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="w-16 px-2 py-2 text-left">Qty</th>
                    <th className="px-2 py-2 text-left">Part number</th>
                    <th className="w-28 px-2 py-2 text-left">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {form.parts.map((row, index) => (
                    <tr key={index} className="border-t border-neutral-100">
                      <td className="px-2 py-1">
                        <input
                          value={row.quantity}
                          onChange={(e) => {
                            const parts = [...form.parts];
                            parts[index] = { ...row, quantity: e.target.value };
                            patch({ parts });
                          }}
                          className={inputClass}
                        />
                      </td>
                      <td className="relative px-2 py-1">
                        <input
                          value={row.partNumber}
                          onFocus={() => setActivePartIndex(index)}
                          onChange={(e) => {
                            const parts = [...form.parts];
                            parts[index] = {
                              ...row,
                              partNumber: e.target.value,
                              productRef: "",
                            };
                            patch({ parts });
                            setProductQuery((prev) => ({
                              ...prev,
                              [index]: e.target.value,
                            }));
                          }}
                          className={inputClass}
                          placeholder="Search SKU"
                        />
                        {activePartIndex === index && productResults.length > 0 ? (
                          <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
                            {productResults.map((product) => (
                              <li key={product._id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parts = [...form.parts];
                                    parts[index] = {
                                      productRef: product._id,
                                      partNumber: product.partNumber,
                                      description: product.name,
                                      quantity: row.quantity || "1",
                                      unitPrice: String(product.unitPrice),
                                    };
                                    patch({ parts });
                                    setActivePartIndex(null);
                                    setProductResults([]);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-50"
                                >
                                  <span className="font-medium">{product.partNumber}</span>
                                  <span className="ml-2 text-neutral-500">
                                    {product.name} · {formatMoney(product.unitPrice)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={row.unitPrice}
                          onChange={(e) => {
                            const parts = [...form.parts];
                            parts[index] = { ...row, unitPrice: e.target.value };
                            patch({ parts });
                          }}
                          className={inputClass}
                        />
                        <p className="mt-0.5 text-[10px] text-neutral-400">
                          Line {formatMoney(partAmount(row))}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            {variant === "work-order" ? (
              <Field label="Description of work performed">
                <textarea
                  rows={8}
                  value={form.descPerformed}
                  onChange={(e) => patch({ descPerformed: e.target.value })}
                  className={inputClass}
                />
              </Field>
            ) : null}
            <div className="space-y-2 rounded border border-neutral-200 p-3 text-sm">
              <div className="flex justify-between">
                <span>Total parts</span>
                <span>{formatMoney(totals.totalParts)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Total labor</span>
                <input
                  value={form.laborOverridden ? form.totalLabor : String(computedLabor)}
                  onChange={(e) =>
                    patch({ laborOverridden: true, totalLabor: e.target.value })
                  }
                  className="w-28 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Misc exp.</span>
                <input
                  value={form.miscExp}
                  onChange={(e) => patch({ miscExp: e.target.value })}
                  className="w-28 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
                />
              </div>
              <div className="flex justify-between border-t border-neutral-200 pt-2">
                <span>Sub total</span>
                <span>{formatMoney(totals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Shipping</span>
                <input
                  value={form.shipping}
                  onChange={(e) => patch({ shipping: e.target.value })}
                  className="w-28 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
                />
              </div>
              <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold">
                <span>Total</span>
                <span>{formatMoney(totals.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Terms & conditions
            </p>
            <p className="text-xs leading-relaxed text-neutral-600">
              {SERVICE_TICKET_TERMS}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Signature
            </p>
            <input
              value={form.signedByName}
              onChange={(e) => patch({ signedByName: e.target.value })}
              placeholder="Signer name"
              className={`${inputClass} mb-2`}
            />
            <SignaturePad
              value={form.signatureDataUrl}
              onChange={(signatureDataUrl) => patch({ signatureDataUrl })}
            />
          </div>
        </div>

        {variant === "work-order" ? (
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={form.completed}
              onChange={(e) => patch({ completed: e.target.checked })}
            />
            Mark completed
          </label>
        ) : null}
      </article>

      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        {extraActions}
        <button
          type="submit"
          disabled={submitting || !form.customerId}
          className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
