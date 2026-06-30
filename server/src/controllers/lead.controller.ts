import { Request, Response } from "express";
import { getMongoStatus } from "../config/mongodb";
import { Lead } from "../models/mongo/Lead";
import { createEstimateLeadSchema } from "../schemas/lead.schema";

export async function createLead(req: Request, res: Response): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: "Database unavailable. Please try again later." });
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
    res.status(201).json({
      id: lead._id.toString(),
      message: "Lead submitted",
    });
  } catch {
    res.status(500).json({ message: "Failed to save lead. Please try again." });
  }
}
