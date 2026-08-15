import { Request, Response } from "express";
import mongoose from "mongoose";
import { getMongoStatus } from "../config/mongodb";
import { AuthRequest } from "../middleware/auth.middleware";
import { activeLeadFilter, Lead } from "../models/mongo/Lead";
import { activeCustomerFilter, Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  createEstimateLeadSchema,
  updateLeadStatusSchema,
} from "../schemas/lead.schema";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  normalizeAddressKey,
  normalizePhoneDigits,
} from "../utils/customerSites";

const notMergedFilter = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

const LEAD_PAGE_SIZES = [25, 50, 150, 250, 500];
const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "lost", "won"]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapLead(lead: {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  status: string;
  source?: string;
  customerRef?: mongoose.Types.ObjectId | null;
  matchedExisting: boolean;
  createdAt: Date;
}) {
  return {
    id: lead._id.toString(),
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone ?? "",
    addressLine1: lead.addressLine1 ?? "",
    addressLine2: lead.addressLine2 ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zipCode: lead.zipCode ?? "",
    status: lead.status,
    source: lead.source ?? "",
    customerRef: lead.customerRef ? lead.customerRef.toString() : null,
    matchedExisting: lead.matchedExisting,
    createdAt: lead.createdAt.toISOString(),
  };
}

export async function createLead(req: Request, res: Response): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res
      .status(503)
      .json({ message: "Database unavailable. Please try again later." });
    return;
  }

  const parsed = createEstimateLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const lead = await Lead.create(parsed.data);

    logNotificationAsync({
      entityType: "lead",
      action: "created",
      entityId: lead._id.toString(),
      summary: `New estimate lead from ${parsed.data.email ?? "unknown"}`,
      actorType: "system",
      actorName: "System",
      metadata: {
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
      },
    });

    res.status(201).json({
      id: lead._id.toString(),
      message: "Lead submitted",
    });
  } catch {
    res.status(500).json({ message: "Failed to save lead. Please try again." });
  }
}

// GET /leads
export async function listLeads(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10);
    const pageSize = LEAD_PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : 25;

    const statusRaw = String(req.query.status ?? "");
    const status = LEAD_STATUSES.has(statusRaw) ? statusRaw : null;

    const search = String(req.query.search ?? "").trim();

    const filter: Record<string, unknown> = {
      ...activeLeadFilter,
      ...(status ? { status } : {}),
    };
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      const or: Array<Record<string, unknown>> = [
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { addressLine1: rx },
        { city: rx },
        { zipCode: rx },
      ];
      const digits = normalizePhoneDigits(search);
      if (digits.length > 0) {
        or.push({ phone: new RegExp(escapeRegex(digits)) });
      }
      filter.$or = or;
    }

    const total = await Lead.countDocuments(filter);
    const leads = await Lead.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    res.status(200).json({
      leads: leads.map(mapLead),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /leads error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// PATCH /leads/:id/status
export async function updateLeadStatus(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid lead id" });
      return;
    }

    const parsed = updateLeadStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const lead = await Lead.findOne({ _id: id, ...activeLeadFilter });
    if (!lead) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    lead.status = parsed.data.status;
    await lead.save();

    logNotificationAsync({
      entityType: "lead",
      action: "updated",
      entityId: lead._id.toString(),
      summary: `Lead ${lead.firstName} ${lead.lastName} marked ${lead.status}`,
      metadata: { status: lead.status },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({ lead: mapLead(lead) });
  } catch (err) {
    console.error("PATCH /leads/:id/status error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// DELETE /leads/:id — soft delete
export async function softDeleteLead(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid lead id" });
      return;
    }

    const lead = await Lead.findOne({ _id: id, ...activeLeadFilter });
    if (!lead) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    lead.deletedAt = new Date();
    await lead.save();

    logNotificationAsync({
      entityType: "lead",
      action: "deleted",
      entityId: lead._id.toString(),
      summary: `Lead ${lead.firstName} ${lead.lastName} deleted`,
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      message: "Lead deleted",
      lead: {
        _id: lead._id.toString(),
        deletedAt: lead.deletedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("DELETE /leads/:id error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /leads/:id/convert — smart dedupe against existing customers, else create a temporary one
export async function convertLead(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid lead id" });
      return;
    }

    const lead = await Lead.findOne({ _id: id, ...activeLeadFilter });
    if (!lead) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }
    if (lead.customerRef) {
      res.status(409).json({ message: "Lead has already been converted" });
      return;
    }

    let matchedCustomerId: mongoose.Types.ObjectId | null = null;

    // (a) Address match — normalized street + zip, no geocoding.
    const addressKey = normalizeAddressKey(lead.addressLine1, lead.zipCode);
    if (addressKey) {
      const customers = await Customer.find({
        ...activeCustomerFilter,
        ...notMergedFilter,
      })
        .select("_id address zip")
        .lean();
      const directMatch = customers.find(
        (c) => normalizeAddressKey(c.address, c.zip) === addressKey,
      );
      if (directMatch) {
        matchedCustomerId = directMatch._id;
      } else {
        const siteAddresses = await CustomerAddress.find({
          customerRef: { $in: customers.map((c) => c._id) },
        })
          .select("customerRef address zip")
          .lean();
        const siteMatch = siteAddresses.find(
          (a) => normalizeAddressKey(a.address, a.zip) === addressKey,
        );
        if (siteMatch) matchedCustomerId = siteMatch.customerRef;
      }
    }

    // (b) Contact match — normalized phone digits / exact email — only if no address match.
    if (!matchedCustomerId) {
      const phoneDigits = normalizePhoneDigits(lead.phone);
      const email = (lead.email ?? "").trim().toLowerCase();
      const customers = await Customer.find({
        ...activeCustomerFilter,
        ...notMergedFilter,
      })
        .select("_id phone email")
        .lean();
      const customerMatch = customers.find(
        (c) =>
          (phoneDigits.length >= 7 &&
            normalizePhoneDigits(c.phone) === phoneDigits) ||
          (email && (c.email ?? "").trim().toLowerCase() === email),
      );
      if (customerMatch) {
        matchedCustomerId = customerMatch._id;
      } else {
        const contacts = await CustomerContact.find({
          customerRef: { $in: customers.map((c) => c._id) },
        })
          .select("customerRef phone email")
          .lean();
        const contactMatch = contacts.find(
          (c) =>
            (phoneDigits.length >= 7 &&
              normalizePhoneDigits(c.phone) === phoneDigits) ||
            (email && (c.email ?? "").trim().toLowerCase() === email),
        );
        if (contactMatch) matchedCustomerId = contactMatch.customerRef;
      }
    }

    if (matchedCustomerId) {
      lead.customerRef = matchedCustomerId;
      lead.matchedExisting = true;
      lead.convertedAt = new Date();
      await lead.save();

      logNotificationAsync({
        entityType: "lead",
        action: "updated",
        entityId: lead._id.toString(),
        customerRef: matchedCustomerId,
        summary: `Lead ${lead.firstName} ${lead.lastName} linked to an existing customer`,
        ...actorFromRequest(req.user),
      });

      res.status(200).json({
        matchedExisting: true,
        customerId: matchedCustomerId.toString(),
      });
      return;
    }

    const phoneDigits = normalizePhoneDigits(lead.phone);
    const customer = await Customer.create({
      accountName: `${lead.firstName} ${lead.lastName}`.trim(),
      first: lead.firstName,
      last: lead.lastName,
      address: lead.addressLine1 ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      zip: lead.zipCode ?? "",
      county: "",
      phone: lead.phone ?? "",
      phoneDigits,
      email: lead.email,
      isTemporary: true,
      leadRef: lead._id,
    });

    await CustomerAddress.create({
      customerRef: customer._id,
      label: "",
      address: lead.addressLine1 ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      zip: lead.zipCode ?? "",
      county: "",
      countyManual: false,
      isPrimary: true,
      propertyType: "residential",
    });

    await CustomerContact.create({
      customerRef: customer._id,
      first: lead.firstName,
      last: lead.lastName,
      phone: lead.phone ?? "",
      email: lead.email,
      label: "",
      isPrimary: true,
    });

    lead.customerRef = customer._id;
    lead.matchedExisting = false;
    lead.convertedAt = new Date();
    await lead.save();

    logNotificationAsync({
      entityType: "lead",
      action: "updated",
      entityId: lead._id.toString(),
      customerRef: customer._id,
      summary: `Lead ${lead.firstName} ${lead.lastName} converted to a temporary customer`,
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      matchedExisting: false,
      customerId: customer._id.toString(),
    });
  } catch (err) {
    console.error("POST /leads/:id/convert error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
