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
  RecommendedRouteDate,
  SlotTechnicianRecommendation,
  TechnicianListItem,
  ApiError,
  getContractsForCustomer,
  getCustomer,
  getCustomers,
  getRecommendedRouteDates,
  getScheduleStaff,
  getTaxSettings,
  getTechnicians,
  getWorkOrderTypes,
  placeScheduleWorkOrder,
  previewOptimalPlacement,
  assignAndOptimizeTechnician,
  recommendTechnicianForSlot,
  WorkOrderListItem,
  WorkOrderNote,
  WorkOrderTypeItem,
} from "@/lib/api";
import { COMPANY, US_STATE_CODES, US_STATES, toUsStateCode } from "@/lib/constants";
import { formatCustomerRecordName } from "@/lib/formatName";
import PhoneInput from "@/components/ui/PhoneInput";
import DayRoutesModal from "@/components/schedule/DayRoutesModal";
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
  DEFAULT_TAX_RATE_PERCENT,
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
  normalizeTimeOfDay,
  resolvedTechnicianColor,
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
  const selfIndex = selfId ? stops.findIndex((stop) => stop._id === selfId) : -1;
  const self = selfIndex >= 0 ? stops[selfIndex] : undefined;
  const others = selfId ? stops.filter((stop) => stop._id !== selfId) : stops;
  const currentInsert =
    selfIndex >= 0
      ? stops.slice(0, selfIndex).filter((stop) => stop._id !== selfId).length
      : null;
  const items: Array<
    { kind: "slot"; insertIndex: number } | { kind: "stop"; stop: WorkOrderListItem }
  > = [];

  for (let index = 0; index <= others.length; index += 1) {
    if (currentInsert === index && self) {
      items.push({ kind: "stop", stop: self });
    } else {
      items.push({ kind: "slot", insertIndex: index });
    }
    if (index < others.length) {
      const other = others[index];
      if (other) items.push({ kind: "stop", stop: other });
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

function technicianInitials(tech: {
  first_name?: string;
  last_name?: string;
  initials?: string | null;
}): string {
  const saved = (tech.initials ?? "").trim().toUpperCase();
  if (saved) return saved;
  const f = (tech.first_name ?? "").trim().charAt(0).toUpperCase();
  const l = (tech.last_name ?? "").trim().charAt(0).toUpperCase();
  return `${f}${l}` || "?";
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

function rankingMinutes(laborHours: string): number {
  const hours = Number(laborHours);
  if (Number.isFinite(hours) && hours > 0) {
    return Math.max(15, Math.round(hours * 60));
  }
  return DEFAULT_ESTIMATED_MINUTES;
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
    payload: ReturnType<typeof ticketToPayload> & {
      scheduleInsertIndex?: number;
      notes?: Array<{
        content: string;
        visibleToCustomer?: boolean;
        isReminder?: boolean;
        mentionUserIds?: string[];
        templateId?: string;
      }>;
    },
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
  const [form, setForm] = useState<TicketFormState>(
    initial ?? emptyTicketForm(variant),
  );
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
  const [recommendedDates, setRecommendedDates] = useState<RecommendedRouteDate[]>([]);
  const [recommendedDatesLoading, setRecommendedDatesLoading] = useState(false);
  const [recommendedDatesPage, setRecommendedDatesPage] = useState(0);
  const [viewScheduleModal, setViewScheduleModal] = useState<{
    date: string;
    techId: string | null;
  } | null>(null);
  const [workOrderTypes, setWorkOrderTypes] = useState<WorkOrderTypeItem[]>([]);
  const [workOrderTypesLoaded, setWorkOrderTypesLoaded] = useState(false);
  const lastAppliedSiteKey = useRef(
    ticketSiteKey(initial ?? emptyTicketForm(variant)),
  );
  const stateTouched = useRef(false);
  const initialAppliedFor = useRef<string | undefined>(undefined);
  const techChoiceLocked = useRef(Boolean(initial?.assignedUserRef));
  const autoAppliedTechId = useRef<string | null>(null);
  const [showEquipment, setShowEquipment] = useState(() =>
    Boolean(recordId && initial && hasSavedEquipment(initial)),
  );
  const [draftNotes, setDraftNotes] = useState<WorkOrderNote[]>([]);
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
    queueMicrotask(() => {
      if (recordId) {
        setShowEquipment(Boolean(initial && hasSavedEquipment(initial)));
      }
      if (initial) {
        setForm(initial);
        lastAppliedSiteKey.current = ticketSiteKey(initial);
      }
    });
  }, [initial, autoSaving, recordId]);

  useEffect(() => {
    if (!token || form.taxOverridden) return;
    let cancelled = false;
    getTaxSettings(token)
      .then(({ settings }) => {
        if (cancelled) return;
        const rate = String(settings.ratePercent ?? DEFAULT_TAX_RATE_PERCENT);
        setForm((prev) => {
          if (prev.taxOverridden || prev.taxRate === rate) return prev;
          return { ...prev, taxRate: rate };
        });
      })
      .catch(() => {
        if (cancelled) return;
        setForm((prev) => {
          if (prev.taxOverridden) return prev;
          const current = Number(prev.taxRate);
          if (Number.isFinite(current) && current > 0) return prev;
          if (prev.taxRate === String(DEFAULT_TAX_RATE_PERCENT)) return prev;
          return { ...prev, taxRate: String(DEFAULT_TAX_RATE_PERCENT) };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, form.taxRate, form.taxOverridden]);

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
      queueMicrotask(() => setCustomerResults([]));
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
    const address = form.customerAddress.trim();
    const hasSite = Boolean(form.addressRef || city || address);
    const startTime = normalizeTimeOfDay(form.desiredStartTime);
    const startBy = normalizeTimeOfDay(form.desiredStartBy);
    if (!hasSite || (startTime && startBy && startBy <= startTime)) {
      queueMicrotask(() => {
        setRecommendedDates([]);
        setRecommendedDatesLoading(false);
        setRecommendedDatesPage(0);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setRecommendedDatesLoading(true));
    const timer = setTimeout(() => {
      getRecommendedRouteDates(token, {
        ...(startTime
          ? {
              startTime,
              estimatedMinutes: rankingMinutes(form.laborHours),
              ...(startBy ? { startBy } : {}),
            }
          : {
              estimatedMinutes: rankingMinutes(form.laborHours),
            }),
        addressRef: form.addressRef || undefined,
        address: address || undefined,
        city: city || undefined,
        state: form.customerState.trim() || undefined,
        zip: form.customerZip.trim() || undefined,
        workOrderTypeRef: form.workOrderTypeRef || undefined,
        excludeWorkOrderId: recordId,
      })
        .then((res) => {
          if (cancelled) return;
          setRecommendedDates(res.dates);
          setRecommendedDatesPage(0);
        })
        .catch(() => {
          if (cancelled) return;
          setRecommendedDates([]);
          setRecommendedDatesPage(0);
        })
        .finally(() => {
          if (!cancelled) setRecommendedDatesLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    token,
    variant,
    form.desiredStartTime,
    form.desiredStartBy,
    form.laborHours,
    form.addressRef,
    form.customerAddress,
    form.customerCity,
    form.customerState,
    form.customerZip,
    form.workOrderTypeRef,
    recordId,
  ]);

  useEffect(() => {
    if (!token || variant !== "work-order") return;
    const city = form.customerCity.trim();
    const hasSite = Boolean(form.addressRef || city);
    const startTime = normalizeTimeOfDay(form.desiredStartTime);
    const startBy = normalizeTimeOfDay(form.desiredStartBy);
    if (!form.date || !hasSite || (startTime && startBy && startBy <= startTime)) {
      queueMicrotask(() => setSlotRank(null));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      recommendTechnicianForSlot(token, {
        date: form.date,
        ...(startTime
          ? {
              startTime,
              estimatedMinutes: rankingMinutes(form.laborHours),
              ...(startBy ? { startBy } : {}),
            }
          : {}),
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
    form.desiredStartTime,
    form.desiredStartBy,
    form.laborHours,
    form.addressRef,
    form.customerAddress,
    form.customerCity,
    form.customerState,
    form.customerZip,
    form.workOrderTypeRef,
    recordId,
  ]);

  const recommendedTech = slotRank?.recommendation ?? null;
  const hasRecommendedDateSelection = useMemo(
    () =>
      Boolean(
        form.date &&
          recommendedDates.some((item) => item.date === form.date),
      ),
    [form.date, recommendedDates],
  );
  useEffect(() => {
    if (
      variant !== "work-order" ||
      !recommendedTech ||
      techChoiceLocked.current ||
      hasRecommendedDateSelection
    ) {
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
        assignedUserRefs: [recommendedTech.userId],
      };
    });
  }, [recommendedTech, variant, hasRecommendedDateSelection]);

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
  const groupedRecommendedDates = useMemo(() => {
    const groups: Array<{
      date: string;
      techs: RecommendedRouteDate[];
    }> = [];
    const byDate = new Map<string, RecommendedRouteDate[]>();
    for (const item of recommendedDates) {
      let list = byDate.get(item.date);
      if (!list) {
        list = [];
        byDate.set(item.date, list);
        groups.push({ date: item.date, techs: list });
      }
      if (!list.some((t) => t.userId === item.userId)) {
        list.push(item);
      }
    }
    return groups;
  }, [recommendedDates]);

  const recommendedTechsForSelectedDate = useMemo(() => {
    if (!form.date) return new Map<string, RecommendedRouteDate>();
    const group = groupedRecommendedDates.find((g) => g.date === form.date);
    if (!group) return new Map<string, RecommendedRouteDate>();
    return new Map(group.techs.map((t) => [t.userId, t]));
  }, [groupedRecommendedDates, form.date]);

  const technicianSectionLitUp = Boolean(
    form.date &&
      recommendedTechsForSelectedDate.size > 0 &&
      form.assignedUserRefs.length === 0,
  );
  const serviceTypeLabel =
    form.workOrderTypeLabel.trim() ||
    workOrderTypes.find((t) => t._id === form.workOrderTypeRef)?.label ||
    "Service";
  const recommendedPageSize = 3;
  const recommendedTotalPages = Math.max(
    1,
    Math.ceil(groupedRecommendedDates.length / recommendedPageSize),
  );
  const safeRecommendedPage = Math.min(
    recommendedDatesPage,
    recommendedTotalPages - 1,
  );
  const visibleRecommendedGroups = groupedRecommendedDates.slice(
    safeRecommendedPage * recommendedPageSize,
    (safeRecommendedPage + 1) * recommendedPageSize,
  );
  const hasRecommendedSite = Boolean(
    form.addressRef ||
      form.customerCity.trim() ||
      form.customerAddress.trim(),
  );

  const technicianRows = useMemo(() => {
    const baseById = new Map(
      schedulableTechnicians.map((t) => [t._id, t]),
    );
    const buildBadges = (
      userId: string,
      fallback: { first_name?: string; last_name?: string; initials?: string | null; scheduleColor?: string | null },
    ) => {
      const rec = recommendedTechsForSelectedDate.get(userId);
      const base = baseById.get(userId);
      const initials = technicianInitials({
        first_name: rec?.first_name ?? fallback.first_name ?? base?.first_name,
        last_name: rec?.last_name ?? fallback.last_name ?? base?.last_name,
        initials: rec?.initials ?? fallback.initials,
      });
      const color = resolvedTechnicianColor(
        userId,
        rec?.scheduleColor ?? fallback.scheduleColor,
      );
      return {
        initials,
        color,
        isDateOption: Boolean(rec),
      };
    };

    if (slotRank) {
      const rows = slotRank.technicians.map((tech) => {
        const rec = recommendedTechsForSelectedDate.get(tech.userId);
        const badges = buildBadges(tech.userId, tech);
        const fallbackReason = rec
          ? rec.matchType === "territory"
            ? `In territory${rec.territoryCity ? ` (${rec.territoryCity})` : ""}`
            : `${rec.distanceMiles < 0.1 ? "<0.1" : rec.distanceMiles} mi away on route`
          : "";
        return {
          userId: tech.userId,
          name: technicianDisplayName(tech),
          reason: tech.reason || fallbackReason,
          recommended:
            recommendedTechsForSelectedDate.size > 0
              ? Boolean(rec)
              : tech.userId === slotRank.recommendation?.userId,
          fits: tech.fits,
          ...badges,
        };
      });
      if (
        form.assignedUserRef &&
        !rows.some((row) => row.userId === form.assignedUserRef)
      ) {
        const badges = buildBadges(form.assignedUserRef, {});
        rows.push({
          userId: form.assignedUserRef,
          name: form.tech.trim() || "Assigned technician",
          reason: "",
          recommended: false,
          fits: true,
          ...badges,
        });
      }
      if (recommendedTechsForSelectedDate.size > 0) {
        rows.sort((a, b) => {
          if (a.isDateOption !== b.isDateOption) {
            return a.isDateOption ? -1 : 1;
          }
          return 0;
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
    const rows = options.map((tech) => {
      const rec = recommendedTechsForSelectedDate.get(tech._id);
      const badges = buildBadges(tech._id, tech);
      const reason = rec
        ? rec.matchType === "territory"
          ? `In territory${rec.territoryCity ? ` (${rec.territoryCity})` : ""}`
          : `${rec.distanceMiles < 0.1 ? "<0.1" : rec.distanceMiles} mi away · ${rec.stopCount} ${rec.stopCount === 1 ? "stop" : "stops"}`
        : "";
      return {
        userId: tech._id,
        name: technicianDisplayName(tech),
        reason,
        recommended: Boolean(rec),
        fits: true,
        ...badges,
      };
    });
    if (recommendedTechsForSelectedDate.size > 0) {
      rows.sort((a, b) => {
        if (a.isDateOption !== b.isDateOption) {
          return a.isDateOption ? -1 : 1;
        }
        return 0;
      });
    }
    return rows;
  }, [
    slotRank,
    schedulableTechnicians,
    form.assignedUserRef,
    form.tech,
    recommendedTechsForSelectedDate,
  ]);
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

  function technicianName(userId: string): string {
    const listed = schedulableTechnicians.find((tech) => tech._id === userId);
    if (listed) return technicianDisplayName(listed);
    const ranked = slotRank?.technicians.find((tech) => tech.userId === userId);
    if (ranked) return technicianDisplayName(ranked);
    const known = form.tech
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return known[form.assignedUserRefs.indexOf(userId)] || "";
  }

  function selectRecommendedDateGroup(date: string) {
    if (!date) return;
    setPendingInsertIndex(null);
    setCollapsedTechId(null);
    setScheduleError(null);
    patch({
      date,
      tech: "",
      assignedUserRef: null,
      assignedUserRefs: [],
    });
  }

  function selectRecommendedDate(item: RecommendedRouteDate) {
    techChoiceLocked.current = true;
    autoAppliedTechId.current = item.userId;
    setCollapsedTechId(null);
    const name = technicianDisplayName(item) || technicianName(item.userId);
    patch({
      date: item.date,
      tech: name,
      assignedUserRef: item.userId,
      assignedUserRefs: [item.userId],
    });

    if (!recordId) {
      if (token && item.date) {
        setScheduleError(null);
        previewOptimalPlacement(token, {
          userId: item.userId,
          date: item.date,
          addressRef: form.addressRef || undefined,
          address: form.customerAddress.trim() || undefined,
          city: form.customerCity.trim() || undefined,
          state: form.customerState.trim() || undefined,
          zip: form.customerZip.trim() || undefined,
          desiredStartTime: form.desiredStartTime || undefined,
          desiredStartBy: form.desiredStartBy || undefined,
          estimatedMinutes: rankingMinutes(form.laborHours),
        })
          .then((res) => {
            setPendingInsertIndex(res.insertIndex);
            patch({
              startTime: res.startTime,
              endTime: res.endTime,
            });
            if (res.warnings.length > 0) {
              setScheduleError(res.warnings.join(" "));
            } else {
              setScheduleError(null);
            }
            setDayStopsNonce((n) => n + 1);
          })
          .catch((err) => {
            setPendingInsertIndex(null);
            setScheduleError(
              err instanceof ApiError
                ? err.message
                : "Couldn't preview optimal schedule placement.",
            );
          });
      }
      return;
    }

    if (recordId && token && dispatcher) {
      setPlacingIndex(0);
      setScheduleError(null);
      assignAndOptimizeTechnician(token, {
        workOrderId: recordId,
        userId: item.userId,
        date: item.date,
      })
        .then((result) => {
          const mine = result.workOrder;
          setForm((prev) => ({
            ...prev,
            date: ticketDateFromRecord(mine) || prev.date,
            startTime: mine.startTime?.trim() || prev.startTime,
            endTime: mine.endTime?.trim() || prev.endTime,
            tech: mine.tech || prev.tech,
            assignedUserRef:
              mine.assignedUserRefs?.[0] ||
              mine.assignedUserRef ||
              prev.assignedUserRef,
            assignedUserRefs:
              mine.assignedUserRefs && mine.assignedUserRefs.length > 0
                ? mine.assignedUserRefs
                : mine.assignedUserRef
                  ? [mine.assignedUserRef]
                  : prev.assignedUserRefs,
          }));
          if (result.warnings.length > 0) {
            setScheduleError(result.warnings.join(" "));
          }
          setDayStopsNonce((n) => n + 1);
        })
        .catch((err) => {
          setScheduleError(
            err instanceof ApiError
              ? err.message
              : "Couldn't assign and optimize technician.",
          );
        })
        .finally(() => {
          setPlacingIndex(null);
        });
    }
  }

  function toggleWorkOrderTechnician(userId: string) {
    if (!userId || form.assignedUserRefs.includes(userId)) {
      techChoiceLocked.current = false;
      autoAppliedTechId.current = null;
      setPendingInsertIndex(null);
      setCollapsedTechId(null);
      setScheduleError(null);
      patch({ tech: "", assignedUserRef: null, assignedUserRefs: [] });
      return;
    }

    techChoiceLocked.current = true;
    autoAppliedTechId.current = userId;
    setCollapsedTechId(null);
    const name = technicianName(userId);
    patch({
      tech: name,
      assignedUserRef: userId,
      assignedUserRefs: [userId],
    });

    if (!recordId) {
      if (token && form.date) {
        setScheduleError(null);
        previewOptimalPlacement(token, {
          userId,
          date: form.date,
          addressRef: form.addressRef || undefined,
          address: form.customerAddress.trim() || undefined,
          city: form.customerCity.trim() || undefined,
          state: form.customerState.trim() || undefined,
          zip: form.customerZip.trim() || undefined,
          desiredStartTime: form.desiredStartTime || undefined,
          desiredStartBy: form.desiredStartBy || undefined,
          estimatedMinutes: rankingMinutes(form.laborHours),
        })
          .then((res) => {
            setPendingInsertIndex(res.insertIndex);
            patch({
              startTime: res.startTime,
              endTime: res.endTime,
            });
            if (res.warnings.length > 0) {
              setScheduleError(res.warnings.join(" "));
            } else {
              setScheduleError(null);
            }
            setDayStopsNonce((n) => n + 1);
          })
          .catch((err) => {
            setPendingInsertIndex(null);
            setScheduleError(
              err instanceof ApiError
                ? err.message
                : "Couldn't preview route placement.",
            );
          });
      }
      return;
    }

    if (token && dispatcher && form.date) {
      setPlacingIndex(0);
      setScheduleError(null);
      assignAndOptimizeTechnician(token, {
        workOrderId: recordId,
        userId,
        date: form.date,
      })
        .then((result) => {
          const mine = result.workOrder;
          setForm((prev) => ({
            ...prev,
            date: ticketDateFromRecord(mine) || prev.date,
            startTime: mine.startTime?.trim() || prev.startTime,
            endTime: mine.endTime?.trim() || prev.endTime,
            tech: mine.tech || prev.tech,
            assignedUserRef:
              mine.assignedUserRefs?.[0] || mine.assignedUserRef || prev.assignedUserRef,
            assignedUserRefs:
              mine.assignedUserRefs && mine.assignedUserRefs.length > 0
                ? mine.assignedUserRefs
                : mine.assignedUserRef
                  ? [mine.assignedUserRef]
                  : prev.assignedUserRefs,
          }));
          if (result.warnings.length > 0) {
            setScheduleError(result.warnings.join(" "));
          }
          setDayStopsNonce((n) => n + 1);
        })
        .catch((err) => {
          setScheduleError(
            err instanceof ApiError
              ? err.message
              : "Couldn't assign and optimize technician.",
          );
        })
        .finally(() => {
          setPlacingIndex(null);
        });
    }
  }

  useEffect(() => {
    if (
      recordId ||
      variant !== "work-order" ||
      !token ||
      !form.assignedUserRef ||
      !form.date
    ) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewOptimalPlacement(token, {
        userId: form.assignedUserRef!,
        date: form.date,
        addressRef: form.addressRef || undefined,
        address: form.customerAddress.trim() || undefined,
        city: form.customerCity.trim() || undefined,
        state: form.customerState.trim() || undefined,
        zip: form.customerZip.trim() || undefined,
        desiredStartTime: form.desiredStartTime || undefined,
        desiredStartBy: form.desiredStartBy || undefined,
        estimatedMinutes: rankingMinutes(form.laborHours),
      })
        .then((res) => {
          if (cancelled) return;
          setPendingInsertIndex(res.insertIndex);
          patch({
            startTime: res.startTime,
            endTime: res.endTime,
          });
          setDayStopsNonce((n) => n + 1);
        })
        .catch(() => {
          /* ignore error */
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    recordId,
    variant,
    token,
    form.assignedUserRef,
    form.date,
    form.desiredStartTime,
    form.desiredStartBy,
    form.addressRef,
    form.customerAddress,
    form.customerCity,
    form.customerState,
    form.customerZip,
    form.laborHours,
  ]);

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
    if (variant === "work-order" && !form.date.trim()) return;
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
      ...(draftNotes.length > 0
        ? {
            notes: draftNotes.map((n) => ({
              content: n.content,
              visibleToCustomer: n.visibleToCustomer,
              isReminder: n.isReminder,
              mentionUserIds: n.mentionUserIds,
            })),
          }
        : {}),
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
  const hasEquipmentLines = hasEquipmentProductLines(form.parts);
  const typeSaveIssue = workOrderTypeSaveIssue({
    variant,
    parts: form.parts,
    workOrderTypeRef: form.workOrderTypeRef,
    types: workOrderTypes,
    typesLoaded: workOrderTypesLoaded,
  });
  const missingRequiredDate = variant === "work-order" && !form.date.trim();
  const autosaveBlockedReason = !form.customerId
    ? "choose a customer."
    : missingRequiredDate
      ? "choose a date."
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
    queueMicrotask(() => setDayStopsNonce((nonce) => nonce + 1));
  }, [autosave.status]);

  useEffect(() => {
    const scheduleTechId =
      collapsedTechId && form.assignedUserRefs.includes(collapsedTechId)
        ? collapsedTechId
        : form.assignedUserRefs[0] || form.assignedUserRef || "";
    if (variant !== "work-order" || !token || !scheduleTechId || !form.date) {
      queueMicrotask(() => {
        setDayStops([]);
        setDayStopsLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setDayStopsLoading(true));
    getScheduleStaff(token, form.date, form.date, scheduleTechId)
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
  }, [
    variant,
    token,
    form.assignedUserRef,
    form.assignedUserRefs,
    form.date,
    dayStopsNonce,
    collapsedTechId,
  ]);

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
            assignedUserRef: mine.assignedUserRefs?.[0] || mine.assignedUserRef || prev.assignedUserRef,
            assignedUserRefs:
              mine.assignedUserRefs && mine.assignedUserRefs.length > 0
                ? mine.assignedUserRefs
                : mine.assignedUserRef
                  ? [mine.assignedUserRef]
                  : prev.assignedUserRefs,
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

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={variant === "estimate" ? "Estimate No" : "Work Order No"}>
            <input value={form.number || "Assigned on save"} disabled className={inputClass} />
          </Field>
          <Field label={variant === "work-order" ? "Date *" : "Date"}>
            <input
              type="date"
              required={variant === "work-order"}
              value={form.date}
              onChange={(e) => patch({ date: e.target.value })}
              className={inputClass}
            />
          </Field>
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

            <div className="mt-5 border-t border-neutral-200 pt-4">
              {token && user && (recordId || variant === "work-order") ? (
                <WorkOrderNotesPanel
                  token={token}
                  recordId={recordId}
                  source={variant === "estimate" ? "estimate" : "work-order"}
                  userId={user.id}
                  canWrite={variant === "estimate" ? canWriteEstimates : canWriteJobs}
                  userRole={user}
                  draftNotes={draftNotes}
                  onDraftNotesChange={setDraftNotes}
                  onDesiredWindowChange={
                    variant === "work-order"
                      ? (window) =>
                          setForm((prev) =>
                            prev.desiredStartTime === window.desiredStartTime &&
                            prev.desiredStartBy === window.desiredStartBy
                              ? prev
                              : { ...prev, ...window },
                          )
                      : undefined
                  }
                  fallbackContent={variant === "work-order" ? form.descPerformed : undefined}
                  visibilityLabel={
                    variant === "estimate"
                      ? "Show on estimate"
                      : "Show on work order & invoice"
                  }
                />
              ) : (
                <p className="text-sm text-neutral-500">
                  Save this {variant === "estimate" ? "estimate" : "work order"} to add notes.
                </p>
              )}
            </div>
          </div>

          {variant === "work-order" ? (
            <div>
              <div className="mb-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Recommended {serviceTypeLabel} Date
                </p>
                {!hasRecommendedSite ? (
                  <p className="mb-2 text-xs text-neutral-500">
                    Add an address to see recommended dates within 10 miles of scheduled routes.
                  </p>
                ) : null}
                <div className="overflow-hidden rounded-md border border-neutral-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="w-8 px-2 py-2">
                          <span className="sr-only">Select</span>
                        </th>
                        <th className="px-2 py-2 font-semibold">Date</th>
                        <th className="px-2 py-2 font-semibold">Technician</th>
                        <th className="px-2 py-2 font-semibold">Route Proximity</th>
                        <th className="px-2 py-2 text-right font-semibold">
                          <span className="sr-only">Schedule</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendedDatesLoading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-3 text-xs text-neutral-500"
                          >
                            Checking scheduled routes and territories…
                          </td>
                        </tr>
                      ) : visibleRecommendedGroups.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-3 text-xs text-neutral-500"
                          >
                            {hasRecommendedSite
                              ? "No scheduled technician routes within 10 miles or matching territories on future dates."
                              : "No recommended dates yet."}
                          </td>
                        </tr>
                      ) : (
                        visibleRecommendedGroups.map((group) => {
                          const selected = form.date === group.date;
                          const primary = group.techs[0]!;
                          const milesText =
                            primary.distanceMiles < 0.1
                              ? "<0.1 mi"
                              : `${primary.distanceMiles} mi`;
                          const territoryCity =
                            primary.territoryCity || primary.closestStopCity;
                          const totalStops = group.techs.reduce(
                            (sum, t) => sum + t.stopCount,
                            0,
                          );
                          return (
                            <tr
                              key={group.date}
                              className={`cursor-pointer border-t border-neutral-200 ${
                                selected ? "bg-neutral-50" : "hover:bg-neutral-50"
                              }`}
                              onClick={() => selectRecommendedDateGroup(group.date)}
                            >
                              <td className="px-2 py-2">
                                <input
                                  type="radio"
                                  name="work-order-recommended-date"
                                  value={group.date}
                                  checked={selected}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => selectRecommendedDateGroup(group.date)}
                                  aria-label={`Select ${formatWeekdayDate(group.date)}`}
                                />
                              </td>
                              <td className="px-2 py-2 font-medium text-brand-dark">
                                {formatWeekdayDate(group.date)}
                              </td>
                              <td className="px-2 py-2 text-brand-dark">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {group.techs.map((tech) => {
                                    const initials = technicianInitials(tech);
                                    const fullName = technicianDisplayName(tech);
                                    const color = resolvedTechnicianColor(
                                      tech.userId,
                                      tech.scheduleColor,
                                    );
                                    return (
                                      <span
                                        key={tech.userId}
                                        title={fullName}
                                        className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[11px] font-bold text-white shadow-2xs"
                                        style={{ backgroundColor: color }}
                                      >
                                        {initials}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-xs text-neutral-500">
                                {primary.matchType === "territory" ? (
                                  <>
                                    In territory
                                    {territoryCity
                                      ? ` (${territoryCity})`
                                      : ""}
                                    {totalStops > 0
                                      ? ` · ${totalStops} ${
                                          totalStops === 1
                                            ? "stop"
                                            : "stops"
                                        }`
                                      : ""}
                                  </>
                                ) : (
                                  <>
                                    {milesText} away · {primary.stopCount}{" "}
                                    {primary.stopCount === 1 ? "stop" : "stops"}
                                    {primary.closestStopCity
                                      ? ` (${primary.closestStopCity})`
                                      : ""}
                                  </>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setViewScheduleModal({
                                      date: group.date,
                                      techId: null,
                                    });
                                  }}
                                  className="whitespace-nowrap rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium text-brand-dark hover:bg-neutral-50"
                                >
                                  View schedule
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {groupedRecommendedDates.length > recommendedPageSize ? (
                  <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                    <span>
                      Showing {safeRecommendedPage * recommendedPageSize + 1}–
                      {Math.min(
                        (safeRecommendedPage + 1) * recommendedPageSize,
                        groupedRecommendedDates.length,
                      )}{" "}
                      of {groupedRecommendedDates.length} dates
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={safeRecommendedPage <= 0}
                        onClick={() =>
                          setRecommendedDatesPage((p) => Math.max(0, p - 1))
                        }
                        className="rounded border border-neutral-300 bg-white px-2 py-0.5 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={safeRecommendedPage >= recommendedTotalPages - 1}
                        onClick={() =>
                          setRecommendedDatesPage((p) =>
                            Math.min(recommendedTotalPages - 1, p + 1),
                          )
                        }
                        className="rounded border border-neutral-300 bg-white px-2 py-0.5 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    technicianSectionLitUp
                      ? "text-brand-orange"
                      : "text-neutral-500"
                  }`}
                >
                  Technician
                </p>
                {technicianSectionLitUp ? (
                  <span className="rounded-full bg-brand-orange/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-orange">
                    Select a recommended technician for{" "}
                    {formatWeekdayDate(form.date)}
                  </span>
                ) : null}
              </div>
              {technicianRankHint ? (
                <p className="mb-2 text-xs text-neutral-500">{technicianRankHint}</p>
              ) : null}
              <div
                className={`overflow-hidden rounded-md border transition-all ${
                  technicianSectionLitUp
                    ? "border-brand-orange ring-2 ring-brand-orange/30"
                    : "border-neutral-200"
                }`}
              >
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
                        const selected = form.assignedUserRefs.includes(row.userId);
                        const showConflict = selected && !row.fits;
                        const dayOpen = selected && collapsedTechId !== row.userId;
                        const dayItems = technicianDayRows(dayStops, recordId);
                        const highlightOption =
                          technicianSectionLitUp && row.isDateOption;
                        return (
                          <Fragment key={row.userId}>
                            <tr
                              className={`cursor-pointer border-t border-neutral-200 transition-colors ${
                                selected
                                  ? "bg-neutral-50"
                                  : highlightOption
                                    ? "bg-brand-orange/10 hover:bg-brand-orange/20"
                                    : "hover:bg-neutral-50"
                              }`}
                              onClick={() => toggleWorkOrderTechnician(row.userId)}
                            >
                              <td className="px-2 py-2">
                                <input
                                  type="checkbox"
                                  name="work-order-technician"
                                  value={row.userId}
                                  checked={selected}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleWorkOrderTechnician(row.userId)}
                                  aria-label={row.name}
                                />
                              </td>
                              <td className="px-2 py-2 text-brand-dark">
                                <span
                                  className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold text-white align-middle"
                                  style={{ backgroundColor: row.color }}
                                >
                                  {row.initials}
                                </span>
                                <span className="align-middle">{row.name}</span>
                                {row.recommended ? (
                                  <span
                                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide align-middle ${
                                      highlightOption
                                        ? "bg-brand-orange text-white"
                                        : "bg-neutral-200 text-brand-dark"
                                    }`}
                                  >
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
                                            ) : dispatcher && form.assignedUserRefs.length < 2 ? (
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
                                                    ? "border-brand-blue bg-blue-50 font-medium text-brand-dark ring-1 ring-brand-blue"
                                                    : "border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-brand-dark"
                                                }`}
                                              >
                                                {placingIndex === item.insertIndex
                                                  ? "Placing…"
                                                  : pendingInsertIndex === item.insertIndex &&
                                                      !recordId
                                                    ? "✓ Auto-placed here (optimized)"
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
              {form.assignedUserRefs.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleWorkOrderTechnician("")}
                  className="mt-2 text-xs font-medium text-neutral-500 hover:text-brand-dark"
                >
                  Clear technician{form.assignedUserRefs.length > 1 ? "s" : ""}
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
                disabled={
                  submitting ||
                  !form.customerId ||
                  missingRequiredDate ||
                  typeSaveIssue.blocked
                }
                className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "Saving…" : submitLabel}
              </button>
            )}
          </div>
        </div>
      </article>
      <DayRoutesModal
        open={viewScheduleModal !== null}
        initialDate={viewScheduleModal?.date ?? ""}
        initialTechId={viewScheduleModal?.techId ?? null}
        onClose={() => setViewScheduleModal(null)}
        onSelectDateAndTech={(date, tech) => {
          selectRecommendedDate({
            date,
            userId: tech._id,
            first_name: tech.first_name,
            last_name: tech.last_name,
            distanceMiles: 0,
            stopCount: 0,
            closestStopCity: "",
          });
        }}
      />
    </form>
  );
}
