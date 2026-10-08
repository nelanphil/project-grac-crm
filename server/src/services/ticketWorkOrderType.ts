import mongoose, { Types } from "mongoose";
import { WorkOrderType } from "../models/mongo/WorkOrderType";

export const SERVICE_TYPE_SLUG = "service";
export const NEW_INSTALL_TYPE_SLUG = "new-install";
export const SWAP_TYPE_SLUG = "swap";

const INSTALL_OR_SWAP = new Set([NEW_INSTALL_TYPE_SLUG, SWAP_TYPE_SLUG]);

type TicketLine = { kind?: string | null; lineType?: string | null };

type ActiveType = { _id: Types.ObjectId; slug: string };

export function partsIncludeEquipment(
  parts: TicketLine[] | undefined | null,
): boolean {
  return (parts ?? []).some(
    (part) =>
      part.lineType !== "note" &&
      part.lineType !== "agreement" &&
      part.kind === "equipment",
  );
}

async function activeTypeBySlug(slug: string): Promise<ActiveType | null> {
  return WorkOrderType.findOne({ slug, deletedAt: null })
    .select("_id slug")
    .lean<ActiveType>();
}

async function activeTypeById(id: string): Promise<ActiveType | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return WorkOrderType.findOne({ _id: id, deletedAt: null })
    .select("_id slug")
    .lean<ActiveType>();
}

/**
 * Equipment lines must be New Install or Swap.
 * Work orders with no equipment and no chosen type become Service.
 * Estimates with no equipment drop the type.
 */
export async function resolveTicketWorkOrderType(opts: {
  requestedRef: string | null | undefined;
  parts: TicketLine[] | undefined | null;
  emptyWithoutEquipment: "service" | "clear";
}): Promise<
  { ok: true; ref: Types.ObjectId | null } | { ok: false; message: string }
> {
  const hasEquipment = partsIncludeEquipment(opts.parts);

  if (hasEquipment) {
    const requested = opts.requestedRef?.trim() || "";
    const type = requested ? await activeTypeById(requested) : null;
    if (type && INSTALL_OR_SWAP.has(type.slug)) {
      return { ok: true, ref: type._id };
    }
    const install = await activeTypeBySlug(NEW_INSTALL_TYPE_SLUG);
    const swap = await activeTypeBySlug(SWAP_TYPE_SLUG);
    if (!install || !swap) {
      return {
        ok: false,
        message: "Add New Install and Swap work order types in Control Panel.",
      };
    }
    return {
      ok: false,
      message: "Choose New Install or Swap when the ticket includes equipment.",
    };
  }

  if (opts.emptyWithoutEquipment === "clear") {
    return { ok: true, ref: null };
  }

  const requested = opts.requestedRef?.trim() || "";
  if (requested) {
    if (!mongoose.Types.ObjectId.isValid(requested)) {
      return { ok: false, message: "Invalid workOrderTypeRef" };
    }
    const type = await activeTypeById(requested);
    if (!type) return { ok: false, message: "Work order type not found" };
    return { ok: true, ref: type._id };
  }

  const service = await activeTypeBySlug(SERVICE_TYPE_SLUG);
  if (!service) {
    return {
      ok: false,
      message: "Add a Service work order type in Control Panel.",
    };
  }
  return { ok: true, ref: service._id };
}
