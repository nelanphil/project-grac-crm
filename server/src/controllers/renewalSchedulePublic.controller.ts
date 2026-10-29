import { Request, Response } from "express";
import {
  confirmPublicRenewalSchedule,
  loadPublicRenewalSchedule,
  RenewalSchedulePublicError,
} from "../services/renewalSchedulePublic.service";

export async function getPublicRenewalSchedule(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const offer = await loadPublicRenewalSchedule(String(req.params.token ?? ""));
    if (offer.status === "invalid") {
      res.status(404).json({ message: "This scheduling link is not valid." });
      return;
    }
    res.json(offer);
  } catch (err) {
    console.error("[renewal-schedule] load failed", err);
    res.status(500).json({ message: "Could not open this scheduling link." });
  }
}

export async function postPublicRenewalSchedule(
  req: Request,
  res: Response,
): Promise<void> {
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  try {
    const result = await confirmPublicRenewalSchedule(
      String(req.params.token ?? ""),
      date,
    );
    res.json({ status: "scheduled", ...result });
  } catch (err) {
    if (err instanceof RenewalSchedulePublicError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("[renewal-schedule] confirm failed", err);
    res.status(500).json({ message: "Could not schedule this visit." });
  }
}
