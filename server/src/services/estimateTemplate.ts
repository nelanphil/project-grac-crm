import mongoose, { Types } from "mongoose";
import { IEstimatePart } from "../models/mongo/Estimate";
import { IEstimateTemplate } from "../models/mongo/EstimateTemplate";
import {
  normalizeParts,
  TicketPartInput,
} from "./serviceTicket";

export function partsForTemplate(
  parts: TicketPartInput[] | undefined,
): IEstimatePart[] {
  return normalizeParts(parts).map((part) => ({
    productRef:
      part.productRef && mongoose.Types.ObjectId.isValid(part.productRef)
        ? new mongoose.Types.ObjectId(part.productRef)
        : null,
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

export function productLineCount(
  parts: Array<{ lineType?: string }> | undefined,
): number {
  return (parts ?? []).filter((part) => part.lineType !== "note").length;
}

export function toPublicEstimateTemplate(
  doc: IEstimateTemplate | Record<string, unknown>,
) {
  const d =
    "toObject" in doc &&
    typeof (doc as IEstimateTemplate).toObject === "function"
      ? (doc as IEstimateTemplate).toObject()
      : (doc as Record<string, unknown>);

  const parts = ((d.parts as IEstimatePart[] | undefined) ?? []).map((part) => ({
    productRef: part.productRef ? String(part.productRef) : null,
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

  return {
    _id: d._id,
    name: d.name,
    descPerform: d.descPerform ?? "",
    laborHours: d.laborHours ?? 0,
    parts,
    productCount: productLineCount(parts),
    isDefault: Boolean(d.isDefault),
    createdBy: d.createdBy ? String(d.createdBy as Types.ObjectId) : null,
    deletedAt: d.deletedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
