import { Types } from "mongoose";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";

export type LastContactMethod = "text" | "email" | "call";

export interface LastOutboundContact {
  at: Date;
  method: LastContactMethod;
  status: string;
}

export interface OutboundTextAttempt {
  customerId: string;
  at: Date;
  channel: string;
  status: string;
}

export interface OutboundEmailAttempt {
  customerId: string;
  at: Date;
  status: string;
}

function methodForChannel(channel: string): LastContactMethod {
  return channel === "voice" ? "call" : "text";
}

/** Keep the newest outbound attempt per customer. Failed attempts still count. */
export function mergeLastOutboundContacts(
  texts: OutboundTextAttempt[],
  emails: OutboundEmailAttempt[],
): Map<string, LastOutboundContact> {
  const result = new Map<string, LastOutboundContact>();

  function consider(customerId: string, contact: LastOutboundContact): void {
    if (!customerId) return;
    const current = result.get(customerId);
    if (!current || contact.at.getTime() > current.at.getTime()) {
      result.set(customerId, contact);
    }
  }

  for (const row of texts) {
    if (!row.at) continue;
    consider(row.customerId, {
      at: row.at,
      method: methodForChannel(row.channel),
      status: row.status ?? "",
    });
  }
  for (const row of emails) {
    if (!row.at) continue;
    consider(row.customerId, {
      at: row.at,
      method: "email",
      status: row.status ?? "",
    });
  }
  return result;
}

/** Newest outbound text, email, or call for each customer. */
export async function lastOutboundContactForCustomers(
  customerIds: Array<Types.ObjectId | string>,
): Promise<Map<string, LastOutboundContact>> {
  const ids = [
    ...new Set(
      customerIds.map((id) => String(id)).filter((id) => Types.ObjectId.isValid(id)),
    ),
  ].map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return new Map();

  const [texts, emails] = await Promise.all([
    TwilioCommunication.aggregate<{
      _id: Types.ObjectId;
      createdAt: Date;
      channel: string;
      status: string;
    }>([
      { $match: { customerRef: { $in: ids }, direction: "outbound" } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customerRef",
          createdAt: { $first: "$createdAt" },
          channel: { $first: "$channel" },
          status: { $first: "$status" },
        },
      },
    ]),
    EmailCommunication.aggregate<{
      _id: Types.ObjectId;
      createdAt: Date;
      status: string;
    }>([
      { $match: { customerRef: { $in: ids }, direction: "outbound" } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customerRef",
          createdAt: { $first: "$createdAt" },
          status: { $first: "$status" },
        },
      },
    ]),
  ]);

  return mergeLastOutboundContacts(
    texts.map((row) => ({
      customerId: String(row._id),
      at: row.createdAt,
      channel: row.channel,
      status: row.status,
    })),
    emails.map((row) => ({
      customerId: String(row._id),
      at: row.createdAt,
      status: row.status,
    })),
  );
}
