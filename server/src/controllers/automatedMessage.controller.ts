import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { saveAutomatedMessageSettingsSchema } from "../schemas/automatedMessage.schema";
import {
  AutomatedMessageError,
  getAutomatedMessageForm,
  saveAutomatedMessageForm,
} from "../services/automatedMessage.service";

export async function getAutomatedMessageSettings(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    res.json(await getAutomatedMessageForm());
  } catch (err) {
    console.error("GET /automated-message-settings error:", err);
    res.status(500).json({ message: "Failed to load automated messages" });
  }
}

export async function saveAutomatedMessageSettings(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = saveAutomatedMessageSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message || "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    res.json(await saveAutomatedMessageForm(parsed.data));
  } catch (err) {
    if (err instanceof AutomatedMessageError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("PUT /automated-message-settings error:", err);
    res.status(500).json({ message: "Failed to save automated messages" });
  }
}
