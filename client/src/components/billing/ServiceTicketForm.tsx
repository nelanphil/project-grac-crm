"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CustomerDetail,
  CustomerListItem,
  TechnicianListItem,
  getContractsForCustomer,
  getCustomer,
  getCustomers,
  getTechnicians,
  getWorkOrderTypes,
  WorkOrderTypeItem,
} from "@/lib/api";
import { COMPANY } from "@/lib/constants";
import { formatCustomerRecordName } from "@/lib/formatName";
import PhoneInput from "@/components/ui/PhoneInput";
import {
  DEFAULT_PRODUCT_DISCOUNTS,
  formatDiscountSummary,
  hasAnyDiscount,
  matchContractForTicket,
  resolveEffectiveDiscounts,
  ticketSiteKey,
} from "@/lib/productDiscounts";
import {
  TicketFormState,
  TicketVariant,
  applyDiscountsToParts,
  emptyTicketForm,
  ticketToPayload,
  ticketTotals,
} from "@/lib/service-ticket";
import { useAuthStore } from "@/store/useAuthStore";
import TicketLineItemsEditor from "@/components/billing/TicketLineItemsEditor";
import WorkOrderNotesPanel from "@/components/billing/WorkOrderNotesPanel";

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

function technicianDisplayName(tech: {
  first_name?: string;
  last_name?: string;
}): string {
  return `${tech.first_name ?? ""} ${tech.last_name ?? ""}`.trim();
}

export default function ServiceTicketForm({
  variant,
  initial,
  recordId,
  submitting,
  submitLabel,
  onSubmit,
  extraActions,
  invoiceAction,
}: {
  variant: TicketVariant;
  initial?: TicketFormState;
  recordId?: string;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (payload: ReturnType<typeof ticketToPayload>) => void | Promise<void>;
  extraActions?: ReactNode;
  invoiceAction?: ReactNode;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWriteJobs = useAuthStore((s) => s.hasPermission("jobs:write"));
  const [form, setForm] = useState<TicketFormState>(initial ?? emptyTicketForm());
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerListItem[]>([]);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [techQuery, setTechQuery] = useState("");
  const [techResults, setTechResults] = useState<TechnicianListItem[]>([]);
  const [techConflict, setTechConflict] = useState(false);
  const [workOrderTypes, setWorkOrderTypes] = useState<WorkOrderTypeItem[]>([]);
  const lastAppliedSiteKey = useRef(
    ticketSiteKey(initial ?? emptyTicketForm()),
  );

  useEffect(() => {
    if (initial) {
      setForm(initial);
      lastAppliedSiteKey.current = ticketSiteKey(initial);
    }
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
    if (!token || variant !== "work-order") return;
    getWorkOrderTypes(token)
      .then(({ types }) => setWorkOrderTypes(types))
      .catch(() => setWorkOrderTypes([]));
  }, [token, variant]);

  useEffect(() => {
    if (!token || techQuery.trim().length < 2) {
      setTechResults([]);
      return;
    }
    const t = setTimeout(() => {
      getTechnicians(token, {
        search: techQuery.trim(),
        date: form.date || undefined,
        excludeWorkOrderId: recordId,
      })
        .then((res) => setTechResults(res.technicians))
        .catch(() => setTechResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [token, techQuery, form.date, recordId]);

  useEffect(() => {
    if (!token || !form.assignedUserRef || !form.date) {
      if (!form.assignedUserRef) setTechConflict(false);
      return;
    }
    let cancelled = false;
    getTechnicians(token, {
      search: form.tech.trim() || undefined,
      date: form.date,
      excludeWorkOrderId: recordId,
    })
      .then((res) => {
        if (cancelled) return;
        const match = res.technicians.find((t) => t._id === form.assignedUserRef);
        setTechConflict(Boolean(match && match.jobsOnDate > 0));
      })
      .catch(() => {
        if (!cancelled) setTechConflict(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, form.assignedUserRef, form.date, form.tech, recordId]);

  useEffect(() => {
    if (!token || !form.customerId) {
      const key = ticketSiteKey(form);
      if (lastAppliedSiteKey.current === key) return;
      lastAppliedSiteKey.current = key;
      setForm((prev) => {
        if (!prev.contractRef && !prev.contractDiscount) return prev;
        return {
          ...prev,
          contractRef: "",
          contractDiscount: null,
          parts: applyDiscountsToParts(prev.parts, DEFAULT_PRODUCT_DISCOUNTS),
        };
      });
      return;
    }

    const key = ticketSiteKey(form);
    const unchanged = key === lastAppliedSiteKey.current;
    lastAppliedSiteKey.current = key;

    if (unchanged && form.contractDiscount) return;

    let cancelled = false;
    getContractsForCustomer(token, form.customerId)
      .then(({ contracts }) => {
        if (cancelled) return;
        const match = matchContractForTicket(contracts, {
          addressRef: form.addressRef,
          equipmentRef: form.equipmentRef,
        });
        const discounts = match
          ? resolveEffectiveDiscounts({
              template: match.template?.productDiscounts,
              contract: match.productDiscounts,
            })
          : DEFAULT_PRODUCT_DISCOUNTS;
        const snapshot =
          match && hasAnyDiscount(discounts)
            ? {
                label: match.template?.label || "Service contract",
                ...discounts,
              }
            : null;
        setForm((prev) => ({
          ...prev,
          contractRef: snapshot ? (match?._id ?? "") : "",
          contractDiscount: snapshot,
          parts: unchanged
            ? prev.parts
            : applyDiscountsToParts(prev.parts, discounts),
        }));
      })
      .catch(() => {
        if (cancelled) return;
        if (!unchanged) {
          setForm((prev) => ({
            ...prev,
            contractRef: "",
            contractDiscount: null,
          }));
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, form.customerId, form.addressRef, form.equipmentRef]);

  const totals = useMemo(() => ticketTotals(form), [form]);
  const discountRules = form.contractDiscount ?? DEFAULT_PRODUCT_DISCOUNTS;
  const discountBanner = form.contractDiscount
    ? formatDiscountSummary(form.contractDiscount, form.contractDiscount.label)
    : null;

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

  function applyTechnician(tech: TechnicianListItem) {
    const name = technicianDisplayName(tech);
    patch({
      tech: name,
      assignedUserRef: variant === "work-order" ? tech._id : null,
    });
    setTechQuery("");
    setTechResults([]);
    setTechConflict(tech.jobsOnDate > 0);
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
      serialNumber: equipment?.serial ?? "",
      generatorModel: equipment?.generatorModel ?? "",
      exerciseDay: equipment?.exday ?? "",
      exerciseTime: equipment?.extime ?? "",
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

  const selectedAddress =
    customer?.addresses.find((a) => a._id === form.addressRef) ??
    customer?.addresses.find((a) => a.isPrimary) ??
    customer?.addresses[0];
  const equipmentOptions = selectedAddress?.equipment ?? [];
  const hasExistingEquipment = equipmentOptions.length > 0;
  const existingEquipmentSelected = Boolean(
    form.equipmentRef &&
      equipmentOptions.some((unit) => unit._id === form.equipmentRef),
  );
  const equipmentFieldsLocked = Boolean(customer && existingEquipmentSelected);

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 print:hidden">
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

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          {variant === "work-order" ? (
            <Field label="Type">
              <select
                value={form.workOrderTypeRef ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  const selected = workOrderTypes.find((type) => type._id === value);
                  patch({
                    workOrderTypeRef: value || null,
                    workOrderTypeLabel: selected?.label ?? "",
                  });
                }}
                className={inputClass}
              >
                <option value="">None</option>
                {workOrderTypes.map((type) => (
                  <option key={type._id} value={type._id}>
                    {type.label}
                  </option>
                ))}
                {form.workOrderTypeRef &&
                !workOrderTypes.some((type) => type._id === form.workOrderTypeRef) ? (
                  <option value={form.workOrderTypeRef}>
                    {form.workOrderTypeLabel || "Current type"}
                  </option>
                ) : null}
              </select>
            </Field>
          ) : null}
          <div className="relative">
            <Field label="Technician">
              <input
                value={techQuery || form.tech}
                onChange={(e) => {
                  const value = e.target.value;
                  setTechQuery(value);
                  patch({
                    tech: value,
                    ...(value.trim() !== form.tech.trim()
                      ? { assignedUserRef: null }
                      : {}),
                  });
                  setTechConflict(false);
                }}
                placeholder="Search technicians"
                className={inputClass}
              />
            </Field>
            {techResults.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg">
                {techResults.map((tech) => (
                  <li key={tech._id}>
                    <button
                      type="button"
                      onClick={() => applyTechnician(tech)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                    >
                      <span className="font-medium text-brand-dark">
                        {technicianDisplayName(tech)}
                      </span>
                      {tech.jobsOnDate > 0 ? (
                        <span className="mt-0.5 block text-xs text-amber-700">
                          Already has a job on this date
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {techConflict ? (
              <p className="mt-1 text-xs text-amber-700">
                This technician already has a job on this date
              </p>
            ) : null}
          </div>
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
          )}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Customer
            </p>
            <div className="relative">
              <input
                value={customerQuery || form.customerName}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  if (form.customerName) patch({ customerName: e.target.value });
                }}
                placeholder="Search customers"
                aria-label="Search customers"
                className={inputClass}
              />
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
              <div className="mt-3">
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
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                <input
                  value={form.customerName}
                  onChange={(e) => patch({ customerName: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Address" className="sm:col-span-2">
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
                <PhoneInput
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
              <Field label="Work phone" className="sm:col-span-2">
                <PhoneInput
                  value={form.workPhone}
                  onChange={(e) => patch({ workPhone: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Equipment
            </p>
            {customer ? (
              <div>
                <select
                  value={existingEquipmentSelected ? form.equipmentRef : ""}
                  onChange={(e) => applyEquipment(e.target.value)}
                  aria-label="Equipment"
                  className={inputClass}
                >
                  {equipmentOptions.map((unit) => (
                    <option key={unit._id} value={unit._id}>
                      {[unit.generatorModel || "Generator", unit.serial]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                  <option value="">
                    {hasExistingEquipment
                      ? "Add another equipment"
                      : "Add new equipment"}
                  </option>
                </select>
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Serial number">
                <input
                  value={form.serialNumber}
                  onChange={(e) => patch({ serialNumber: e.target.value })}
                  readOnly={equipmentFieldsLocked}
                  className={`${inputClass}${equipmentFieldsLocked ? " bg-neutral-50" : ""}`}
                />
              </Field>
              <Field label="Model">
                <input
                  value={form.generatorModel}
                  onChange={(e) => patch({ generatorModel: e.target.value })}
                  readOnly={equipmentFieldsLocked}
                  className={`${inputClass}${equipmentFieldsLocked ? " bg-neutral-50" : ""}`}
                />
              </Field>
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
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start">
          <TicketLineItemsEditor
            parts={form.parts}
            discounts={discountRules}
            onChange={(parts) => patch({ parts })}
            banner={
              discountBanner ? (
                <p className="text-[11px] font-normal normal-case tracking-normal text-sky-800">
                  {discountBanner}
                </p>
              ) : null
            }
          />

          <div className="w-full shrink-0 space-y-2 rounded border border-neutral-200 p-3 text-sm lg:w-72">
            {discountBanner ? (
              <p className="rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-800">
                {discountBanner}
              </p>
            ) : null}
            <div className="flex justify-between">
              <span>Total parts</span>
              <span>{formatMoney(totals.totalParts)}</span>
            </div>
            <div className="flex justify-between">
              <span>Total labor</span>
              <span>{formatMoney(totals.totalLabor)}</span>
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
            {variant === "work-order" && invoiceAction ? (
              <div className="pt-2">{invoiceAction}</div>
            ) : null}
          </div>
        </div>

        {variant === "estimate" ? (
          <div className="mt-5">
            <Field label="Description of work to be performed">
              <textarea
                rows={6}
                value={form.descPerform}
                onChange={(e) => patch({ descPerform: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        ) : token && user && recordId ? (
          <div className="mt-5">
            <WorkOrderNotesPanel
              token={token}
              workOrderId={recordId}
              userId={user.id}
              canWrite={canWriteJobs}
              userRole={user.role}
              fallbackContent={form.descPerformed}
            />
          </div>
        ) : variant === "work-order" ? (
          <p className="mt-5 text-sm text-neutral-500">
            Save this work order to add notes.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-neutral-200 pt-5">
          {variant === "work-order" ? (
            <div className="flex flex-wrap items-end gap-8">
              <Field label="Paid">
                <div className="flex h-9 items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={form.paid}
                      onChange={() => patch({ paid: true })}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={!form.paid}
                      onChange={() => patch({ paid: false })}
                    />
                    No
                  </label>
                </div>
              </Field>
              <Field label="Completed">
                <label className="inline-flex h-9 items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={form.completed}
                    onChange={(e) => patch({ completed: e.target.checked })}
                  />
                  Mark completed
                </label>
              </Field>
            </div>
          ) : (
            <div />
          )}
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
        </div>
      </article>
    </form>
  );
}
