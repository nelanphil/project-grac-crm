import { Request, Response } from "express";
import { getMongoStatus } from "../config/mongodb";
import { SmsOptIn } from "../models/mongo/SmsOptIn";
import { User, activeUserFilter } from "../models/mongo/User";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { recordCustomerActivityAsync } from "../services/customerActivity.service";
import { submitSmsOptInSchema } from "../schemas/smsOptIn.schema";
import { canonicalPhoneDigits } from "../utils/customerSites";

const GENERIC_ERROR =
  "Unable to save your opt-in right now. Please try again later or call us.";

export async function submitSmsOptIn(
  req: Request,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: GENERIC_ERROR });
    return;
  }

  const parsed = submitSmsOptInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const digits = canonicalPhoneDigits(parsed.data.phone);
  if (!digits) {
    res.status(400).json({
      message: "A valid 10-digit mobile number is required to opt in to text messages",
    });
    return;
  }

  const now = new Date();
  const ip = req.ip || req.socket.remoteAddress || null;

  try {
    await SmsOptIn.findOneAndUpdate(
      { phoneDigits: digits },
      {
        $set: {
          phoneDigits: digits,
          phone: parsed.data.phone,
          source: "sms-program",
          consentedAt: now,
          ip,
        },
      },
      { upsert: true, new: true },
    );

    const digitPattern = digits.split("").join("[^0-9]*");
    await User.updateMany(
      { ...activeUserFilter, phone: { $regex: digitPattern } },
      { $set: { smsOptIn: true, smsOptInAt: now } },
    );

    const contacts = await CustomerContact.find({
      deletedAt: null,
      phone: { $regex: digitPattern },
    })
      .select("customerRef")
      .lean();
    const seen = new Set<string>();
    for (const contact of contacts) {
      if (!contact.customerRef) continue;
      const id = String(contact.customerRef);
      if (seen.has(id)) continue;
      seen.add(id);
      recordCustomerActivityAsync({
        customerRef: contact.customerRef,
        category: "communication",
        action: "opted_in",
        summary: "Opted in to text messages",
        actorKind: "customer",
        actorName: "Customer",
        entityType: "sms_opt_in",
        entityId: digits,
        source: "portal",
        ip,
      });
    }

    res.json({
      message:
        "You are opted in to transactional text messages from Generator Maintenance of Florida. Reply STOP to opt out.",
    });
  } catch (err) {
    console.error("POST /sms-opt-in error:", err);
    res.status(500).json({ message: GENERIC_ERROR });
  }
}
