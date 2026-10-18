import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  ContactFormSubmission,
  IContactFormSubmission,
} from "../models/mongo/ContactFormSubmission";
import { importContactFormSubmissions } from "../services/contactFormSubmission.service";

const PAGE_SIZES = new Set([25, 50, 100]);

function toPublic(row: {
  _id: unknown;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  source: IContactFormSubmission["source"];
  readAt?: Date | null;
  createdAt: Date;
}) {
  return {
    _id: String(row._id),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone ?? "",
    message: row.message,
    source: row.source,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listContactFormSubmissions(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10) || 25;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 25;

    const filter: Record<string, unknown> = {};
    const from = new Date(String(req.query.from ?? ""));
    const to = new Date(String(req.query.to ?? ""));
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      filter.createdAt = { $gte: from, $lt: to };
    }

    const [total, rows] = await Promise.all([
      ContactFormSubmission.countDocuments(filter),
      ContactFormSubmission.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    res.json({
      submissions: rows.map((row) => toPublic(row)),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /contact-submissions error:", err);
    res.status(500).json({ message: "Failed to list contact form submissions" });
  }
}

export async function markContactFormSubmissionRead(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid submission id" });
      return;
    }
    const row = await ContactFormSubmission.findById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Submission not found" });
      return;
    }
    if (!row.readAt) {
      row.readAt = new Date();
      await row.save();
    }
    res.json({ submission: toPublic(row) });
  } catch (err) {
    console.error("POST /contact-submissions/:id/read error:", err);
    res.status(500).json({ message: "Failed to mark submission read" });
  }
}

export async function importContactFormMailbox(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await importContactFormSubmissions();
    res.json(result);
  } catch (err) {
    console.error("POST /contact-submissions/import error:", err);
    res.status(500).json({ message: "Failed to import contact form mail" });
  }
}
