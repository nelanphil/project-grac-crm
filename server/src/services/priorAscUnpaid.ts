import { Types } from "mongoose";
import { Product } from "../models/mongo/Product";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { pendingPaymentWorkOrderFilter } from "./completedPaidReport";
import {
  ascWorkOrderMatchClauses,
  findAscProductIds,
} from "./ascContractSync";
import type { UnpaidAscWorkOrder } from "../utils/ascUnpaidRenewals";

/** Completed unpaid ASC visits for these customers. Same query as the renewal list. */
export async function loadUnpaidAscWorkOrders(
  customerRefs: string[],
): Promise<UnpaidAscWorkOrder[]> {
  const ids = [
    ...new Set(customerRefs.filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (ids.length === 0) return [];

  const ascProductIds = await findAscProductIds(Product);
  const tickets = await WorkOrder.find({
    ...pendingPaymentWorkOrderFilter(),
    customerRef: { $in: ids },
    $or: ascWorkOrderMatchClauses(ascProductIds),
  })
    .select("_id number legacyId date total customerRef")
    .lean();

  return tickets.map((ticket) => ({
    _id: String(ticket._id),
    number: ticket.number,
    legacyId: ticket.legacyId,
    date: ticket.date,
    total: ticket.total,
    customerRef: ticket.customerRef ? String(ticket.customerRef) : "",
  }));
}
