import { Request, Response } from "express";
import {
  emailPreferenceTokenQuerySchema,
  updatePublicEmailPreferenceSchema,
} from "../schemas/emailPreference.schema";
import {
  getEmailPreferences,
  setEmailPreferences,
} from "../utils/emailPreferences";
import { verifyUnsubscribeToken } from "../utils/unsubscribeToken";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { recordCustomerActivityAsync } from "../services/customerActivity.service";

function tokenFromRequest(req: Request): string {
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const body = req.body as { token?: unknown } | undefined;
  const bodyToken = typeof body?.token === "string" ? body.token : "";
  return (queryToken || bodyToken).trim();
}

export async function getPublicEmailPreferences(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = emailPreferenceTokenQuerySchema.safeParse({
    token: tokenFromRequest(req),
  });
  if (!parsed.success) {
    res.status(400).json({ message: "A valid unsubscribe link is required." });
    return;
  }

  const verified = verifyUnsubscribeToken(parsed.data.token);
  if (!verified) {
    res.status(400).json({
      message: "This unsubscribe link is invalid or has expired.",
    });
    return;
  }

  try {
    const prefs = await getEmailPreferences(verified.email);
    res.json({
      email: prefs.email,
      generalNotifications: prefs.generalNotifications,
      billingAlerts: prefs.billingAlerts,
      channel: verified.channel,
    });
  } catch (err) {
    console.error("GET /email-preferences error:", err);
    res.status(500).json({ message: "Failed to load email preferences." });
  }
}

export async function updatePublicEmailPreferences(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = updatePublicEmailPreferenceSchema.safeParse({
    ...((req.body as object) ?? {}),
    token: tokenFromRequest(req),
  });
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const verified = verifyUnsubscribeToken(parsed.data.token);
  if (!verified) {
    res.status(400).json({
      message: "This unsubscribe link is invalid or has expired.",
    });
    return;
  }

  try {
    const prefs = await setEmailPreferences(verified.email, {
      generalNotifications: parsed.data.generalNotifications,
      billingAlerts: parsed.data.billingAlerts,
    });
    res.json({
      email: prefs.email,
      generalNotifications: prefs.generalNotifications,
      billingAlerts: prefs.billingAlerts,
      channel: verified.channel,
    });
  } catch (err) {
    console.error("PATCH /email-preferences error:", err);
    res.status(500).json({ message: "Failed to save email preferences." });
  }
}

/** RFC 8058 one-click unsubscribe. Turns off general notifications. */
export async function oneClickUnsubscribe(
  req: Request,
  res: Response,
): Promise<void> {
  const verified = verifyUnsubscribeToken(tokenFromRequest(req));
  if (!verified) {
    res.status(400).json({
      message: "This unsubscribe link is invalid or has expired.",
    });
    return;
  }

  try {
    const channelOff =
      verified.channel === "billing"
        ? { billingAlerts: false }
        : { generalNotifications: false };
    const prefs = await setEmailPreferences(verified.email, channelOff);
    const email = verified.email.toLowerCase();
    const [contacts, customers] = await Promise.all([
      CustomerContact.find({ email, deletedAt: null }).select("customerRef").lean(),
      Customer.find({
        email,
        deletedAt: null,
        mergedIntoRef: null,
      })
        .select("_id")
        .lean(),
    ]);
    const seen = new Set<string>();
    for (const customer of customers) seen.add(String(customer._id));
    for (const contact of contacts) {
      if (contact.customerRef) seen.add(String(contact.customerRef));
    }
    const channelLabel =
      verified.channel === "billing" ? "billing emails" : "emails";
    for (const customerRef of seen) {
      recordCustomerActivityAsync({
        customerRef,
        category: "communication",
        action: "unsubscribed",
        summary: `Unsubscribed from ${channelLabel}`,
        actorKind: "customer",
        actorName: "Customer",
        entityType: "email_preference",
        entityId: email,
        source: "portal",
        metadata: { channel: verified.channel, email },
      });
    }
    res.status(200).json({
      email: prefs.email,
      generalNotifications: prefs.generalNotifications,
      billingAlerts: prefs.billingAlerts,
      channel: verified.channel,
    });
  } catch (err) {
    console.error("POST /email-preferences/one-click error:", err);
    res.status(500).json({ message: "Failed to unsubscribe." });
  }
}
