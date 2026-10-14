"use client";

import {
  FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CustomerDetail,
  CustomerListItem,
  SlotTechnicianRecommendation,
  TechnicianListItem,
  ApiError,
  getContractsForCustomer,
  getCustomer,
  getCustomers,
  getScheduleStaff,
  getTaxSettings,
  getTechnicians,
  getWorkOrderTypes,
  placeScheduleWorkOrder,
  recommendTechnicianForSlot,
  WorkOrderListItem,
  WorkOrderTypeItem,
} from "@/lib/api";
import { COMPANY, US_STATE_CODES, US_STATES, toUsStateCode } from "@/lib/constants";
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
  hasEquipmentProductLines,
  mergeSavedTicket,
  nextTicketWorkOrderType,
  ticketToPayload,
  ticketTotals,
  ticketDateFromRecord,
  workOrderTypeSaveIssue,
} from "@/lib/service-ticket";
import { useWorkOrderAutosave } from "@/lib/useWorkOrderAutosave";
import AutosaveStatus from "@/components/billing/AutosaveStatus";
import { useAuthStore } from "@/store/useAuthStore";
import {
  DEFAULT_ESTIMATED_MINUTES,
  formatLocalClock,
  formatWeekdayDate,
  minutesToHhMm,
  normalizeTimeOfDay,
  timeWindowError,
} from "@/lib/schedule";
import { isDispatcherRole } from "@/lib/dashboard-role";
import EquipmentWorkOrderTypeChoice from "@/components/billing/EquipmentWorkOrderTypeChoice";
import {
  ExerciseDaySelect,
  ExerciseTimeInput,
} from "@/components/billing/ExerciseScheduleFields";
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

function formatTaxRate(rate: number): string {
  const rounded = Math.round(rate * 10000) / 10000;
  return `${rounded}%`;
}

function taxInputValue(amount: number): string {
  if (!amount) return "";
  return String(amount);
}

function serializeTicket(form: TicketFormState): string {
  return JSON.stringify(ticketToPayload(form));
}

function stopSummary(stop: WorkOrderListItem): string {
  const place = [stop.customerAddress, stop.customerCity].filter(Boolean).join(", ");
  const when = stop.scheduledStart
    ? formatLocalClock(new Date(stop.scheduledStart))
    : stop.startTime || "";
  return [when, stop.customerName || "Work order", place].filter(Boolean).join(" · ");
}

function technicianDayRows(stops: WorkOrderListItem[], selfId?: string) {
  const currentIndex = selfId ? stops.findIndex((stop) => stop._id === selfId) : -1;
  const currentInsert =
    currentIndex >= 0
      ? stops.slice(0, currentIndex).filter((stop) => stop._id !== selfId).length
      : null;
  const items: Array<
    { kind: "slot"; insertIndex: number } | { kind: "stop"; stop: WorkOrderListItem }
  > = [];
  let otherIndex = 0;
  if (currentInsert !== 0) items.push({ kind: "slot", insertIndex: 0 });
  for (const stop of stops) {
    items.push({ kind: "stop", stop });
    if (selfId && stop._id === selfId) continue;
    otherIndex += 1;
    if (otherIndex !== currentInsert) {
      items.push({ kind: "slot", insertIndex: otherIndex });
    }
  }
  return items;
}

function technicianDisplayName(tech: {
  first_name?: string;
  last_name?: string;
}): string {
  return `${tech.first_name ?? ""} ${tech.last_name ?? ""}`.trim();
}

function splitPersonName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first_name: parts[0] ?? name.trim(), last_name: "" };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1] ?? "",
  };
}

function compareTechnicianNames(
  a: { first_name?: string; last_name?: string },
  b: { first_name?: string; last_name?: string },
): number {
  const byLast = (a.last_name ?? "").localeCompare(b.last_name ?? "", undefined, {
    sensitivity: "base",
  });
  if (byLast !== 0) return byLast;
  return (a.first_name ?? "").localeCompare(b.first_name ?? "", undefined, {
    sensitivity: "base",
  });
}

/** End time for ranking. A blank end uses a 30-minute window from the start. */
function slotEndTime(start: string, end: string): string | null {
  const startTime = normalizeTimeOfDay(start);
  if (!startTime) return null;
  const explicitEnd = normalizeTimeOfDay(end);
  if (explicitEnd) {
    return timeWindowError(startTime, explicitEnd) ? null : explicitEnd;
  }
  const [hour, minute] = startTime.split(":").map(Number);
  return minutesToHhMm((hour ?? 0) * 60 + (minute ?? 0) + DEFAULT_ESTIMATED_MINUTES);
}

function hasSavedEquipment(form: {
  equipmentRef?: string;
  serialNumber?: string;
  generatorModel?: string;
}): boolean {
  return Boolean(
    form.equipmentRef || form.serialNumber?.trim() || form.generatorModel?.trim(),
  );
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
  autoSave,
}: {
  variant: TicketVariant;
  initial?: TicketFormState;
  recordId?: string;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (
    payload: ReturnType<typeof ticketToPayload> & { scheduleInsertIndex?: number },
  ) => void | Promise<void>;
  extraActions?: ReactNode;
  invoiceAction?: ReactNode;
  /**
   * Saves an existing record as the user edits instead of showing a submit
   * button. Must throw on failure and resolve with the saved record as form state.
   */
  autoSave?: (payload: ReturnType<typeof ticketToPayload>) => Promise<TicketFormState>;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWriteJobs = useAuthStore((s) => s.hasPermission("jobs:write"));
  const canWriteEstimates = useAuthStore((s) => s.hasPermission("estimates:write"));
  const [form, setForm] = useState<TicketFormState>(initial ?? emptyTicketForm());
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerListItem[]>([]);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [schedulableTechnicians, setSchedulableTechnicians] = useState<
    TechnicianListItem[]
  >([]);
  const [slotRank, setSlotRank] = useState<{
    technicians: SlotTechnicianRecommendation[];
    recommendation: SlotTechnicianRecommendation | null;
  } | null>(null);
  const [workOrderTypes, setWorkOrderTypes] = useState<WorkOrderTypeItem[]>([]);
  const [workOrderTypesLoaded, setWorkOrderTypesLoaded] = useState(false);
  const lastAppliedSiteKey = useRef(
    ticketSiteKey(initial ?? emptyTicketForm()),
  );
  const stateTouched = useRef(false);
  const initialAppliedFor = useRef<string | undefined>(undefined);
  const techChoiceLocked = useRef(Boolean(initial?.assignedUserRef));
  const autoAppliedTechId = useRef<string | null>(null);
  const [showEquipment, setShowEquipment] = useState(() =>
    Boolean(recordId && initial && hasSavedEquipment(initial)),
  );
  const [dayStops, setDayStops] = useState<WorkOrderListItem[]>([]);
  const [dayStopsLoading, setDayStopsLoading] = useState(false);
  const [dayStopsNonce, setDayStopsNonce] = useState(0);
  const [collapsedTechId, setCollapsedTechId] = useState<string | null>(null);
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(null);
  const [placingIndex, setPlacingIndex] = useState<number | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const autoSaving = Boolean(autoSave);
  const dispatcher = isDispatcherRole(user);

  useEffect(() => {
    // Autosaved records feed each save back as `initial`; resetting to it
    // would drop edits typed while the save was in flight.
    if (autoSaving && initial && initialAppliedFor.current === recordId) return;
    initialAppliedFor.current = recordId;
    stateTouched.current = false;
    techChoiceLocked.current = Boolean(initial?.assignedUserRef);
    autoAppliedTechId.current = null;
    if (recordId) {
      setShowEquipment(Boolean(initial && hasSavedEquipment(initial)));
    }
    if (initial) {
      setForm(initial);
      lastAppliedSiteKey.current = ticketSiteKey(initial);
    }
  }, [initial, autoSaving, recordId]);

  useEffect(() => {
    if (!token || recordId) return;
    if (form.taxOverridden || form.taxRate !== "") return;
    let cancelled = false;
    getTaxSettings(token)
      .then(({ settings }) => {
        if (cancelled) return;
        setForm((prev) => {
          if (prev.taxRate !== "" || prev.taxOverridden) return prev;
          return {
            ...prev,
            taxRate: String(settings.ratePercent ?? 0),
          };
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, recordId, form.taxRate, form.taxOverridden]);

  useEffect(() => {
    if (!token || !form.customerRef) return;
    getCustomer(token, form.customerRef)
      .then(({ customer: c }) => {
        setCustomer(c);
        setForm((prev) => {
          const linked = prev.addressRef
            ? c.addresses.find((a) => a._id === prev.addressRef)
            : undefined;
          const site =
            linked ??
            c.addresses.find((a) => a.isPrimary) ??
            c.addresses[0];
          const nextState = stateTouched.current || prev.customerState.trim()
            ? prev.customerState || "FL"
            : toUsStateCode(site?.state);
          if (prev.addressRef || c.addresses.length === 0) {
            return nextState === prev.customerState
              ? prev
              : { ...prev, customerState: nextState };
          }
          const equipment = site.equipment?.[0];
          return {
            ...prev,
            addressRef: site._id,
            customerAddress: prev.customerAddress || site.address,
            customerCity: prev.customerCity || site.city,
            customerState: nextState,
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
    if (!token) return;
    let cancelled = false;
    getWorkOrderTypes(token)
      .then(({ types }) => {
        if (!cancelled) setWorkOrderTypes(types);
      })
      .catch(() => {
        if (!cancelled) setWorkOrderTypes([]);
      })
      .finally(() => {
        if (!cancelled) setWorkOrderTypesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const hasEquipmentNow = hasEquipmentProductLines(form.parts);
  if (workOrderTypes.length > 0) {
    const nextType = nextTicketWorkOrderType({
      variant,
      hadEquipment: form.trackedEquipment,
      hasEquipment: hasEquipmentNow,
      workOrderTypeRef: form.workOrderTypeRef,
      workOrderTypeLabel: form.workOrderTypeLabel,
      types: workOrderTypes,
    });
    if (
      nextType.workOrderTypeRef !== form.workOrderTypeRef ||
      nextType.workOrderTypeLabel !== form.workOrderTypeLabel ||
      form.trackedEquipment !== hasEquipmentNow
    ) {
      setForm({
        ...form,
        workOrderTypeRef: nextType.workOrderTypeRef,
        workOrderTypeLabel: nextType.workOrderTypeLabel,
        trackedEquipment: hasEquipmentNow,
      });
    }
  }

  useEffect(() => {
    if (!token || variant !== "work-order") return;
    let cancelled = false;
    getTechnicians(token, { all: true })
      .then((res) => {
        if (!cancelled) setSchedulableTechnicians(res.technicians);
      })
      .catch(() => {
        if (!cancelled) setSchedulableTechnicians([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, variant]);

  useEffect(() => {
    if (!token || variant !== "work-order") return;
    const city = form.customerCity.trim();
    const hasSite = Boolean(form.addressRef || city);
    const startTime = normalizeTimeOfDay(form.startTime);
    const endTime = startTime ? slotEndTime(form.startTime, form.endTime) : null;
    if (!form.date || !hasSite || (startTime && !endTime)) {
      setSlotRank(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      recommendTechnicianForSlot(token, {
        date: form.date,
        ...(startTime && endTime ? { startTime, endTime } : {}),
        addressRef: form.addressRef || undefined,
        address: form.customerAddress.trim() || undefined,
        city: city || undefined,
        state: form.customerState.trim() || undefined,
        zip: form.customerZip.trim() || undefined,
        workOrderTypeRef: form.workOrderTypeRef || undefined,
        excludeWorkOrderId: recordId,
      })
        .then((res) => {
          if (!cancelled) setSlotRank(res);
        })
        .catch(() => {
          if (!cancelled) setSlotRank(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    token,
    variant,
    form.date,
    form.startTime,
    form.endTime,
    form.addressRef,
    form.customerAddress,
    form.customerCity,
    form.customerState,
    form.customerZip,
    form.workOrderTypeRef,
    recordId,
  ]);

  const recommendedTech = slotRank?.recommendation ?? null;
  useEffect(() => {
    if (variant !== "work-order" || !recommendedTech || techChoiceLocked.current) {
      return;
    }
    const name = technicianDisplayName(recommendedTech);
    setForm((prev) => {
      if (
        prev.assignedUserRef &&
        prev.assignedUserRef !== autoAppliedTechId.current
      ) {
        return prev;
      }
      if (prev.assignedUserRef === recommendedTech.userId && prev.tech === name) {
        return prev;
      }
      autoAppliedTechId.current = recommendedTech.userId;
      return {
        ...prev,
        tech: name,
        assignedUserRef: recommendedTech.userId,
      };
    });
  }, [recommendedTech, variant]);

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
  const technicianRows = useMemo(() => {
    if (slotRank) {
      const rows = slotRank.technicians.map((tech) => ({
        userId: tech.userId,
        name: technicianDisplayName(tech),
        reason: tech.reason,
        recommended: tech.userId === slotRank.recommendation?.userId,
        fits: tech.fits,
      }));
      if (
        form.assignedUserRef &&
        !rows.some((row) => row.userId === form.assignedUserRef)
      ) {
        rows.push({
          userId: form.assignedUserRef,
          name: form.tech.trim() || "Assigned technician",
          reason: "",
          recommended: false,
          fits: true,
        });
      }
      return rows;
    }

    const options = [...schedulableTechnicians];
    if (
      form.assignedUserRef &&
      !options.some((tech) => tech._id === form.assignedUserRef)
    ) {
      const name = splitPersonName(form.tech);
      options.push({
        _id: form.assignedUserRef,
        first_name: name.first_name || "Assigned technician",
        last_name: name.last_name,
        jobsOnDate: 0,
      });
    }
    options.sort(compareTechnicianNames);
    return options.map((tech) => ({
      userId: tech._id,
      name: technicianDisplayName(tech),
      reason: "",
      recommended: false,
      fits: true,
    }));
  }, [slotRank, schedulableTechnicians, form.assignedUserRef, form.tech]);
  const technicianRankHint = useMemo(() => {
    if (variant !== "work-order" || slotRank) return null;
    const missing: string[] = [];
    if (!form.date) missing.push("a date");
    if (!form.addressRef && !form.customerCity.trim()) missing.push("an address");
    if (missing.length === 0) return null;
    if (missing.length === 1) return `Add ${missing[0]} to rank technicians.`;
    const last = missing[missing.length - 1];
    return `Add ${missing.slice(0, -1).join(", ")} and ${last} to rank technicians.`;
  }, [
    variant,
    slotRank,
    form.date,
    form.addressRef,
    form.customerCity,
  ]);
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
      customerState: toUsStateCode(primary?.state || c.state),
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

  function selectWorkOrderTechnician(userId: string) {
    setPendingInsertIndex(null);
    if (!userId) {
      techChoiceLocked.current = false;
      autoAppliedTechId.current = null;
      patch({ tech: "", assignedUserRef: null });
      return;
    }
    techChoiceLocked.current = true;
    const listed = schedulableTechnicians.find((tech) => tech._id === userId);
    const ranked = slotRank?.technicians.find((tech) => tech.userId === userId);
    const name = listed
      ? technicianDisplayName(listed)
      : ranked
        ? technicianDisplayName(ranked)
        : form.tech;
    patch({ tech: name, assignedUserRef: userId });
  }

  function applyAddress(addressId: string) {
    const site = customer?.addresses.find((a) => a._id === addressId);
    const equipment = site?.equipment?.[0];
    patch({
      addressRef: addressId,
      customerAddress: site?.address ?? form.customerAddress,
      customerCity: site?.city ?? form.customerCity,
      customerState: toUsStateCode(site?.state || form.customerState),
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
    if (autoSave) {
      autosave.arm();
      autosave.flush();
      return;
    }
    if (!form.customerId) return;
    if (variant === "work-order" && timeWindowError(form.startTime, form.endTime)) {
      return;
    }
    if (
      workOrderTypeSaveIssue({
        variant,
        parts: form.parts,
        workOrderTypeRef: form.workOrderTypeRef,
        types: workOrderTypes,
        typesLoaded: workOrderTypesLoaded,
      }).blocked
    ) {
      return;
    }
    await onSubmit({
      ...ticketToPayload(form),
      ...(pendingInsertIndex != null ? { scheduleInsertIndex: pendingInsertIndex } : {}),
    });
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
  const windowError =
    variant === "work-order" ? timeWindowError(form.startTime, form.endTime) : null;
  const hasEquipmentLines = hasEquipmentProductLines(form.parts);
  const typeSaveIssue = workOrderTypeSaveIssue({
    variant,
    parts: form.parts,
    workOrderTypeRef: form.workOrderTypeRef,
    types: workOrderTypes,
    typesLoaded: workOrderTypesLoaded,
  });
  const autosaveBlockedReason = !form.customerId
    ? "choose a customer."
    : windowError
      ? windowError
      : typeSaveIssue.blocked
        ? typeSaveIssue.message || "loading work order types…"
        : null;

  const saveDraft = useCallback(
    async (sent: TicketFormState) => {
      if (!autoSave) return;
      const saved = await autoSave(ticketToPayload(sent));
      setForm((current) => mergeSavedTicket(current, sent, saved));
    },
    [autoSave],
  );
  const autosave = useWorkOrderAutosave({
    value: form,
    serialize: serializeTicket,
    save: saveDraft,
    blocked: !autoSave || autosaveBlockedReason !== null,
  });

  useEffect(() => {
    if (autosave.status !== "saved") return;
    setDayStopsNonce((nonce) => nonce + 1);
  }, [autosave.status]);

  useEffect(() => {
    if (variant !== "work-order" || !token || !form.assignedUserRef || !form.date) {
      setDayStops([]);
      setDayStopsLoading(false);
      return;
    }
    let cancelled = false;
    setDayStopsLoading(true);
    getScheduleStaff(token, form.date, form.date, form.assignedUserRef)
      .then((board) => {
        if (cancelled) return;
        const stops = [...board.workOrders].sort((a, b) => {
          const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
          const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
          return aStart - bStart;
        });
        setDayStops(stops);
      })
      .catch(() => {
        if (!cancelled) setDayStops([]);
      })
      .finally(() => {
        if (!cancelled) setDayStopsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [variant, token, form.assignedUserRef, form.date, dayStopsNonce]);

  const placeOnTechnicianDay = useCallback(
    async (insertIndex: number) => {
      if (!form.assignedUserRef || !form.date) return;
      if (!recordId) {
        setPendingInsertIndex(insertIndex);
        setScheduleError(null);
        return;
      }
      if (!token || !dispatcher) return;
      setPlacingIndex(insertIndex);
      setScheduleError(null);
      try {
        const result = await placeScheduleWorkOrder(token, {
          workOrderId: recordId,
          assignedUserRef: form.assignedUserRef,
          date: form.date,
          insertIndex,
        });
        const mine = result.workOrders.find((job) => job._id === recordId);
        if (mine) {
          setForm((prev) => ({
            ...prev,
            date: ticketDateFromRecord(mine) || prev.date,
            startTime: mine.startTime?.trim() || prev.startTime,
            endTime: mine.endTime?.trim() || prev.endTime,
            tech: mine.tech || prev.tech,
            assignedUserRef: mine.assignedUserRef ?? prev.assignedUserRef,
          }));
        }
        if (result.warnings.length > 0) {
          setScheduleError(result.warnings.join(" "));
        }
        setDayStopsNonce((nonce) => nonce + 1);
      } catch (err) {
        setScheduleError(
          err instanceof ApiError ? err.message : "Couldn't place this work order.",
        );
      } finally {
        setPlacingIndex(null);
      }
    },
    [dispatcher, form.assignedUserRef, form.date, recordId, token],
  );

  const equipmentPanel = (
    <>
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
              {hasExistingEquipment ? "Add another equipment" : "Add new equipment"}
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
          <ExerciseDaySelect
            value={form.exerciseDay}
            onChange={(exerciseDay) => patch({ exerciseDay })}
            className={inputClass}
          />
        </Field>
        <Field label="Time Set">
          <ExerciseTimeInput
            value={form.exerciseTime}
            onChange={(exerciseTime) => patch({ exerciseTime })}
            className={inputClass}
          />
        </Field>
        {variant === "work-order" ? (
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
        ) : null}
      </div>
    </>
  );

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onChangeCapture={autoSave ? autosave.arm : undefined}
      onClickCapture={autoSave ? autosave.arm : undefined}
      onBlurCapture={autoSave ? autosave.flush : undefined}
      className="space-y-6 print:hidden"
    >
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

        <div
          className={`mt-5 grid gap-3 sm:grid-cols-2 ${
            variant === "work-order" ? "lg:grid-cols-5" : "lg:grid-cols-3"
          }`}
        >
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
            <>
              <Field label="Start time">
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => patch({ startTime: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="End time">
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => patch({ endTime: e.target.value })}
                  className={inputClass}
                />
                {windowError ? (
                  <p className="mt-1 text-xs text-amber-700">{windowError}</p>
                ) : null}
              </Field>
            </>
          ) : null}
          {variant === "work-order" && !hasEquipmentLines ? (
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
          ) : null}
        </div>

        <div
          className={`mt-5 grid gap-5 ${
            variant === "work-order" ? "lg:grid-cols-2" : ""
          }`}
        >
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
              <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-6">
                <Field label="City" className="sm:col-span-3">
                  <input
                    value={form.customerCity}
                    onChange={(e) => patch({ customerCity: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="State" className="sm:col-span-1">
                  <select
                    value={form.customerState || "FL"}
                    onChange={(e) => {
                      stateTouched.current = true;
                      patch({ customerState: e.target.value });
                    }}
                    className={inputClass}
                  >
                    {US_STATES.map((name) => (
                      <option key={name} value={US_STATE_CODES[name]}>
                        {US_STATE_CODES[name]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ZIP" className="sm:col-span-2">
                  <input
                    value={form.customerZip}
                    onChange={(e) => patch({ customerZip: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </div>
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

          {variant === "work-order" ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Technician
              </p>
              {technicianRankHint ? (
                <p className="mb-2 text-xs text-neutral-500">{technicianRankHint}</p>
              ) : null}
              <div className="overflow-hidden rounded-md border border-neutral-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="w-8 px-2 py-2">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-2 py-2 font-semibold">Technician</th>
                      <th className="px-2 py-2 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {technicianRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-xs text-neutral-500">
                          No technicians are schedulable.
                        </td>
                      </tr>
                    ) : (
                      technicianRows.map((row) => {
                        const selected = form.assignedUserRef === row.userId;
                        const showConflict = selected && !row.fits;
                        const dayOpen = selected && collapsedTechId !== row.userId;
                        const dayItems = technicianDayRows(dayStops, recordId);
                        return (
                          <Fragment key={row.userId}>
                            <tr
                              className={`cursor-pointer border-t border-neutral-200 ${
                                selected ? "bg-neutral-50" : "hover:bg-neutral-50"
                              }`}
                              onClick={() => selectWorkOrderTechnician(row.userId)}
                            >
                              <td className="px-2 py-2">
                                <input
                                  type="radio"
                                  name="work-order-technician"
                                  value={row.userId}
                                  checked={selected}
                                  onChange={() => selectWorkOrderTechnician(row.userId)}
                                  aria-label={row.name}
                                />
                              </td>
                              <td className="px-2 py-2 text-brand-dark">
                                {row.name}
                                {row.recommended ? (
                                  <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-dark">
                                    Recommended
                                  </span>
                                ) : null}
                              </td>
                              <td
                                className={`px-2 py-2 text-xs ${
                                  showConflict ? "text-amber-700" : "text-neutral-500"
                                }`}
                              >
                                {row.reason}
                              </td>
                            </tr>
                            {selected ? (
                              <tr className="border-t border-neutral-200 bg-neutral-50">
                                <td colSpan={3} className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCollapsedTechId(dayOpen ? row.userId : null)
                                    }
                                    className="flex items-center gap-2 text-xs font-semibold text-brand-dark"
                                    aria-expanded={dayOpen}
                                  >
                                    <span aria-hidden="true">{dayOpen ? "▾" : "▸"}</span>
                                    {form.date
                                      ? `${formatWeekdayDate(form.date)} schedule`
                                      : "Schedule"}
                                    {dayStopsLoading ? (
                                      <span className="font-normal text-neutral-500">
                                        Loading…
                                      </span>
                                    ) : form.date ? (
                                      <span className="font-normal text-neutral-500">
                                        {dayStops.length}{" "}
                                        {dayStops.length === 1 ? "stop" : "stops"}
                                      </span>
                                    ) : null}
                                  </button>
                                  {dayOpen ? (
                                    <div className="mt-2 space-y-1">
                                      {!form.date ? (
                                        <p className="text-xs text-neutral-500">
                                          Set a date to see this technician&apos;s appointments.
                                        </p>
                                      ) : dayStops.length === 0 && !dayStopsLoading ? (
                                        <p className="text-xs text-neutral-500">
                                          No appointments on this day yet.
                                        </p>
                                      ) : null}
                                      {form.date
                                        ? dayItems.map((item) =>
                                            item.kind === "stop" ? (
                                              <p
                                                key={item.stop._id}
                                                className={`rounded px-2 py-1 text-xs ${
                                                  item.stop._id === recordId
                                                    ? "bg-white font-medium text-brand-dark"
                                                    : "text-neutral-600"
                                                }`}
                                              >
                                                {stopSummary(item.stop)}
                                                {item.stop._id === recordId
                                                  ? " · This work order"
                                                  : ""}
                                              </p>
                                            ) : dispatcher ? (
                                              <button
                                                key={`slot-${item.insertIndex}`}
                                                type="button"
                                                disabled={placingIndex !== null}
                                                onClick={() =>
                                                  void placeOnTechnicianDay(item.insertIndex)
                                                }
                                                className={`block w-full rounded border border-dashed px-2 py-1 text-left text-xs ${
                                                  pendingInsertIndex === item.insertIndex &&
                                                  !recordId
                                                    ? "border-brand-blue bg-white font-medium text-brand-dark"
                                                    : "border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-brand-dark"
                                                }`}
                                              >
                                                {placingIndex === item.insertIndex
                                                  ? "Placing…"
                                                  : pendingInsertIndex === item.insertIndex &&
                                                      !recordId
                                                    ? "This work order will be placed here"
                                                    : item.insertIndex === 0
                                                      ? "Place first"
                                                      : item.insertIndex ===
                                                          dayStops.filter(
                                                            (stop) => stop._id !== recordId,
                                                          ).length
                                                        ? "Place last"
                                                        : "Place here"}
                                              </button>
                                            ) : null,
                                          )
                                        : null}
                                      {scheduleError ? (
                                        <p className="text-xs text-amber-700">{scheduleError}</p>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {form.assignedUserRef ? (
                <button
                  type="button"
                  onClick={() => selectWorkOrderTechnician("")}
                  className="mt-2 text-xs font-medium text-neutral-500 hover:text-brand-dark"
                >
                  Clear technician
                </button>
              ) : null}
              {showEquipment ? (
                <div className="mt-5">{equipmentPanel}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowEquipment(true)}
                  className="mt-3 inline-flex items-center rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Add equipment
                </button>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-3">
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
            {hasEquipmentLines ? (
              <EquipmentWorkOrderTypeChoice
                types={workOrderTypes}
                value={form.workOrderTypeRef}
                message={typeSaveIssue.message}
                onChange={(type) =>
                  patch({
                    workOrderTypeRef: type._id,
                    workOrderTypeLabel: type.label,
                  })
                }
              />
            ) : typeSaveIssue.message ? (
              <p className="text-sm text-red-700">{typeSaveIssue.message}</p>
            ) : null}
          </div>

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
            <div className="flex justify-between">
              <span>Total agreements</span>
              <span>{formatMoney(totals.totalAgreements)}</span>
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
            <div className="flex items-center justify-between gap-2">
              <span>
                Tax
                {totals.taxRate > 0 ? ` (${formatTaxRate(totals.taxRate)})` : ""}
              </span>
              <input
                value={form.taxOverridden ? form.tax : taxInputValue(totals.tax)}
                onChange={(e) =>
                  patch({ tax: e.target.value, taxOverridden: true })
                }
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
        ) : null}

        {token && user && recordId ? (
          <div className="mt-5">
            <WorkOrderNotesPanel
              token={token}
              recordId={recordId}
              source={variant === "estimate" ? "estimate" : "work-order"}
              userId={user.id}
              canWrite={variant === "estimate" ? canWriteEstimates : canWriteJobs}
              userRole={user}
              fallbackContent={variant === "work-order" ? form.descPerformed : undefined}
              visibilityLabel={
                variant === "estimate"
                  ? "Show on estimate"
                  : "Show on work order & invoice"
              }
            />
          </div>
        ) : (
          <p className="mt-5 text-sm text-neutral-500">
            Save this {variant === "estimate" ? "estimate" : "work order"} to add notes.
          </p>
        )}

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
            {autoSave ? (
              <AutosaveStatus
                status={autosave.status}
                error={autosave.error}
                blockedReason={autosaveBlockedReason}
                onRetry={autosave.retry}
                className="mr-auto sm:mr-2"
              />
            ) : null}
            {extraActions}
            {autoSave ? null : (
              <button
                type="submit"
                disabled={submitting || !form.customerId || typeSaveIssue.blocked}
                className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "Saving…" : submitLabel}
              </button>
            )}
          </div>
        </div>
      </article>
    </form>
  );
}
