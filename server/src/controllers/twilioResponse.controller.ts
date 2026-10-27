import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  TWILIO_RESPONSES_SLUG,
  TwilioResponseSettings,
} from "../models/mongo/TwilioResponseSettings";
import { saveTwilioResponseSettingsSchema } from "../schemas/twilioResponse.schema";
import { loadMissedCallText } from "../services/missedCall.service";

function toPublic(missedCallText: string) {
  return { missedCallText };
}

export async function getTwilioResponseSettings(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const missedCallText = await loadMissedCallText();
    res.json(toPublic(missedCallText));
  } catch (err) {
    console.error("GET /twilio-response-settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function saveTwilioResponseSettings(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = saveTwilioResponseSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const doc = await TwilioResponseSettings.findOneAndUpdate(
      { slug: TWILIO_RESPONSES_SLUG },
      {
        $set: {
          slug: TWILIO_RESPONSES_SLUG,
          missedCallText: parsed.data.missedCallText,
        },
      },
      { new: true, upsert: true },
    );
    res.json(toPublic(doc.missedCallText));
  } catch (err) {
    console.error("PUT /twilio-response-settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
