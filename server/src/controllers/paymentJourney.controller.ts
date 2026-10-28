import { Request, Response } from "express";
import { journeyBatchSchema, journeySnapshotSchema } from "../schemas/paymentJourney.schema";
import { ingestJourneyBatch, ingestJourneySnapshot } from "../services/paymentJourney.service";

/** Batches arrive as text/plain so sendBeacon can post them without a CORS preflight. */
function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function postJourneyEvents(req: Request, res: Response): Promise<void> {
  const parsed = journeyBatchSchema.safeParse(parseBody(req.body));
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid journey batch" });
    return;
  }
  try {
    const result = await ingestJourneyBatch({
      batch: parsed.data,
      userAgent: String(req.get("user-agent") ?? ""),
      ip: req.ip || null,
    });
    res.status(result.stored ? 202 : 204).end();
  } catch (err) {
    console.error("[payment-journey] ingest failed", err);
    res.status(204).end();
  }
}

export async function postJourneySnapshot(req: Request, res: Response): Promise<void> {
  const parsed = journeySnapshotSchema.safeParse(parseBody(req.body));
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid snapshot" });
    return;
  }
  try {
    const result = await ingestJourneySnapshot({
      snapshot: parsed.data,
      userAgent: String(req.get("user-agent") ?? ""),
      ip: req.ip || null,
    });
    res.status(result.stored ? 202 : 204).end();
  } catch (err) {
    console.error("[payment-journey] snapshot failed", err);
    res.status(204).end();
  }
}
