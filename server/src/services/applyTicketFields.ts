import mongoose, { Types } from "mongoose";
import { Customer, ICustomer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { Equipment } from "../models/mongo/Equipment";
import { customerDisplayName } from "./notification.service";
import {
  computeTicketTotals,
  NormalizedTicketPart,
  normalizeParts,
  TicketPartInput,
} from "./serviceTicket";
import {
  hasAnyDiscount,
  normalizeProductDiscounts,
  TicketContractDiscount,
} from "../utils/productDiscounts";

export type TicketSnapshotFields = {
  customerName?: string;
  customerAddress?: string;
  customerCity?: string;
  customerZip?: string;
  customerPhone?: string;
  customerEmail?: string;
  workPhone?: string;
  serialNumber?: string;
  generatorModel?: string;
  exerciseDay?: string;
  exerciseTime?: string;
};

export type TicketBodyFields = TicketSnapshotFields & {
  descPerform?: string;
  descPerformed?: string;
  date?: string | null;
  tech?: string;
  paid?: boolean;
  completed?: boolean;
  certify?: boolean;
  runHours?: number;
  laborHours?: number;
  totalLabor?: number;
  laborOverridden?: boolean;
  miscExp?: number;
  shipping?: number;
  parts?: TicketPartInput[];
  signatureDataUrl?: string | null;
  signedByName?: string;
  addressRef?: string | null;
  equipmentRef?: string | null;
  contractRef?: string | null;
  contractDiscount?: Partial<TicketContractDiscount> | null;
};

function asObjectId(value: string | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function partsForDoc(parts: NormalizedTicketPart[]) {
  return parts.map((part) => ({
    productRef: asObjectId(part.productRef),
    lineType: part.lineType,
    kind: part.kind,
    partNumber: part.partNumber,
    description: part.description,
    quantity: part.quantity,
    unitPrice: part.unitPrice,
    listPrice: part.listPrice,
    priceOverridden: part.priceOverridden,
    amount: part.amount,
  }));
}

export async function resolveTicketSnapshot(opts: {
  customer: Pick<
    ICustomer,
    | "accountName"
    | "first"
    | "last"
    | "address"
    | "city"
    | "zip"
    | "phone"
    | "email"
    | "serial"
    | "generatorModel"
    | "exday"
    | "extime"
  >;
  addressRef?: string | null;
  equipmentRef?: string | null;
  overrides?: TicketSnapshotFields;
}): Promise<Required<TicketSnapshotFields>> {
  const { customer, overrides = {} } = opts;
  let address = {
    address: customer.address ?? "",
    city: customer.city ?? "",
    zip: customer.zip ?? "",
  };
  if (opts.addressRef && mongoose.Types.ObjectId.isValid(opts.addressRef)) {
    const site = await CustomerAddress.findById(opts.addressRef)
      .select("address city zip")
      .lean();
    if (site) {
      address = {
        address: site.address ?? "",
        city: site.city ?? "",
        zip: site.zip ?? "",
      };
    }
  }

  let equipment = {
    serialNumber: customer.serial ?? "",
    generatorModel: customer.generatorModel ?? "",
    exerciseDay: customer.exday ?? "",
    exerciseTime: customer.extime ?? "",
  };
  if (opts.equipmentRef && mongoose.Types.ObjectId.isValid(opts.equipmentRef)) {
    const unit = await Equipment.findById(opts.equipmentRef)
      .select("serial generatorModel exday extime")
      .lean();
    if (unit) {
      equipment = {
        serialNumber: unit.serial ?? "",
        generatorModel: unit.generatorModel ?? "",
        exerciseDay: unit.exday ?? "",
        exerciseTime: unit.extime ?? "",
      };
    }
  }

  return {
    customerName: overrides.customerName?.trim() || customerDisplayName(customer),
    customerAddress: overrides.customerAddress?.trim() || address.address,
    customerCity: overrides.customerCity?.trim() || address.city,
    customerZip: overrides.customerZip?.trim() || address.zip,
    customerPhone: overrides.customerPhone?.trim() || customer.phone || "",
    customerEmail: overrides.customerEmail?.trim() || customer.email || "",
    workPhone: overrides.workPhone?.trim() || "",
    serialNumber: overrides.serialNumber?.trim() || equipment.serialNumber,
    generatorModel: overrides.generatorModel?.trim() || equipment.generatorModel,
    exerciseDay: overrides.exerciseDay?.trim() || equipment.exerciseDay,
    exerciseTime: overrides.exerciseTime?.trim() || equipment.exerciseTime,
  };
}

export function applyTicketMoney(
  target: {
    parts: unknown;
    laborHours: number;
    runHours: number;
    totalParts: number;
    totalLabor: number;
    laborOverridden: boolean;
    miscExp: number;
    subtotal: number;
    shipping: number;
    total: number;
    contractRef?: unknown;
    contractDiscount?: TicketContractDiscount | null;
  },
  body: TicketBodyFields,
): void {
  if (body.parts !== undefined) {
    target.parts = partsForDoc(normalizeParts(body.parts));
  }
  if (body.laborHours !== undefined) target.laborHours = body.laborHours;
  if (body.runHours !== undefined) target.runHours = body.runHours;
  if (body.laborOverridden !== undefined) {
    target.laborOverridden = body.laborOverridden;
  } else if (body.totalLabor !== undefined) {
    target.laborOverridden = true;
  }
  if (body.miscExp !== undefined) target.miscExp = body.miscExp;
  if (body.shipping !== undefined) target.shipping = body.shipping;
  if (body.contractRef !== undefined) {
    target.contractRef = asObjectId(body.contractRef);
  }
  if (body.contractDiscount !== undefined) {
    if (body.contractDiscount == null) {
      target.contractDiscount = null;
    } else {
      const discounts = normalizeProductDiscounts(body.contractDiscount);
      target.contractDiscount = hasAnyDiscount(discounts)
        ? {
            label: (body.contractDiscount.label ?? "").trim(),
            ...discounts,
          }
        : null;
      if (!target.contractDiscount) target.contractRef = null;
    }
  }

  const parts =
    (target.parts as Array<{
      amount: number;
      lineType?: string;
      kind?: string;
    }>) ?? [];
  const totals = computeTicketTotals({
    parts,
    laborHours: target.laborHours,
    totalLabor: body.totalLabor ?? target.totalLabor,
    laborOverridden: target.laborOverridden,
    miscExp: target.miscExp,
    shipping: target.shipping,
    contractDiscount: target.contractDiscount ?? undefined,
  });
  target.totalParts = totals.totalParts;
  target.totalLabor = totals.totalLabor;
  target.miscExp = totals.miscExp;
  target.subtotal = totals.subtotal;
  target.shipping = totals.shipping;
  target.total = totals.total;
}

export async function applyTicketFields(
  target: Record<string, unknown>,
  body: TicketBodyFields,
  customer: ICustomer,
): Promise<void> {
  if (body.descPerform !== undefined) target.descPerform = body.descPerform;
  if (body.descPerformed !== undefined) target.descPerformed = body.descPerformed;
  if (body.tech !== undefined) target.tech = body.tech;
  if (body.paid !== undefined) target.paid = body.paid;
  if (body.completed !== undefined) target.completed = body.completed;
  if (body.certify !== undefined) target.certify = body.certify;
  if (body.date !== undefined) {
    target.date = body.date ? new Date(body.date) : null;
  }

  if (body.addressRef !== undefined) {
    target.addressRef = asObjectId(body.addressRef);
  }
  if (body.equipmentRef !== undefined) {
    target.equipmentRef = asObjectId(body.equipmentRef);
  }

  const snapshot = await resolveTicketSnapshot({
    customer,
    addressRef:
      body.addressRef !== undefined
        ? body.addressRef
        : target.addressRef
          ? String(target.addressRef)
          : null,
    equipmentRef:
      body.equipmentRef !== undefined
        ? body.equipmentRef
        : target.equipmentRef
          ? String(target.equipmentRef)
          : null,
    overrides: body,
  });
  Object.assign(target, snapshot);

  applyTicketMoney(
    target as {
      parts: unknown;
      laborHours: number;
      runHours: number;
      totalParts: number;
      totalLabor: number;
      laborOverridden: boolean;
      miscExp: number;
      subtotal: number;
      shipping: number;
      total: number;
      contractRef?: unknown;
      contractDiscount?: TicketContractDiscount | null;
    },
    body,
  );

  if (body.signatureDataUrl !== undefined) {
    const next = body.signatureDataUrl ?? "";
    target.signatureDataUrl = next;
    if (next) {
      target.signedAt = new Date();
      if (body.signedByName !== undefined) {
        target.signedByName = body.signedByName;
      }
    } else {
      target.signedAt = null;
      target.signedByName = "";
    }
  } else if (body.signedByName !== undefined) {
    target.signedByName = body.signedByName;
  }
}

export async function loadCustomerForTicket(legacyId: number) {
  return Customer.findOne({ legacyId });
}
