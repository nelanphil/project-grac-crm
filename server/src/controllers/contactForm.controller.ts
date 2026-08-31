import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { getMongoStatus } from "../config/mongodb";
import {
  CONTACT_FORM_SLUG,
  ContactFormSettings,
} from "../models/mongo/ContactFormSettings";
import {
  saveContactFormSettingsSchema,
  submitContactFormSchema,
} from "../schemas/contactForm.schema";
import {
  isRoleMailConfigured,
  sendRoleEmail,
} from "../services/email.service";
import { buildContactFormEmail } from "../utils/emailTemplates";
import { verifyRecaptchaToken } from "../services/recaptcha.service";

const GENERIC_SEND_ERROR =
  "Unable to send your message right now. Please try again later or call us.";

function toPublic(emails: string[]) {
  return { emails };
}

export async function getContactFormSettings(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const doc = await ContactFormSettings.findOne({
      slug: CONTACT_FORM_SLUG,
    }).lean();
    res.json(toPublic(doc?.emails ?? []));
  } catch (err) {
    console.error("GET /contact-form-settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function saveContactFormSettings(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = saveContactFormSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const doc = await ContactFormSettings.findOneAndUpdate(
      { slug: CONTACT_FORM_SLUG },
      { $set: { slug: CONTACT_FORM_SLUG, emails: parsed.data.emails } },
      { new: true, upsert: true },
    );
    res.json(toPublic(doc.emails));
  } catch (err) {
    console.error("PUT /contact-form-settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function submitContactForm(
  req: Request,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res.status(503).json({ message: GENERIC_SEND_ERROR });
    return;
  }

  const parsed = submitContactFormSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { website, recaptchaToken, ...fields } = parsed.data;
  if ((website ?? "").trim()) {
    res.json({ message: "Thank you. We'll be in touch shortly." });
    return;
  }

  try {
    const recaptcha = await verifyRecaptchaToken({
      token: recaptchaToken ?? "",
      remoteIp: req.ip || req.socket.remoteAddress || undefined,
      expectedAction: "contact",
    });
    if (!recaptcha.ok) {
      res.status(400).json({ message: recaptcha.message });
      return;
    }

    const settings = await ContactFormSettings.findOne({
      slug: CONTACT_FORM_SLUG,
    }).lean();
    const recipients = (settings?.emails ?? []).filter(Boolean);

    if (recipients.length === 0) {
      res.status(503).json({ message: GENERIC_SEND_ERROR });
      return;
    }

    const mailReady = await isRoleMailConfigured("general_notifications");
    if (!mailReady) {
      res.status(503).json({ message: GENERIC_SEND_ERROR });
      return;
    }

    const { subject, text, html } = buildContactFormEmail(fields);

    await sendRoleEmail("general_notifications", {
      to: recipients.join(", "),
      replyTo: fields.email,
      subject,
      text,
      html,
    });

    res.json({ message: "Thank you. We'll be in touch shortly." });
  } catch (err) {
    console.error("POST /contact error:", err);
    res.status(503).json({ message: GENERIC_SEND_ERROR });
  }
}
