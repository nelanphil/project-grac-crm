import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  previewAutomatedMessageSchema,
  saveAutomatedMessageSettingsSchema,
  testAutomatedMessageSchema,
} from "../schemas/automatedMessage.schema";
import {
  AutomatedMessageError,
  getAutomatedMessageForm,
  saveAutomatedMessageForm,
} from "../services/automatedMessage.service";
import {
  previewAutomatedMessage,
  sendAutomatedMessageTest,
} from "../services/automatedMessageTest.service";

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

export async function testAutomatedMessageSettings(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = testAutomatedMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message || "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    res.json(await sendAutomatedMessageTest(parsed.data));
  } catch (err) {
    if (err instanceof AutomatedMessageError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("POST /automated-message-settings/test error:", err);
    res.status(500).json({ message: "Failed to send the test" });
  }
}

export async function previewAutomatedMessageSettings(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = previewAutomatedMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message || "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    res.json(await previewAutomatedMessage(parsed.data));
  } catch (err) {
    if (err instanceof AutomatedMessageError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("POST /automated-message-settings/preview error:", err);
    res.status(500).json({ message: "Failed to preview the message" });
  }
}
