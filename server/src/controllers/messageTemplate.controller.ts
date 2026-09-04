import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  MessageTemplate,
  IMessageTemplate,
  slugifyMessageTemplateName,
  uniqueMessageTemplateSlug,
  MessageTemplateType,
} from "../models/mongo/MessageTemplate";
import {
  createMessageTemplateSchema,
  updateMessageTemplateSchema,
  SMS_BODY_MAX,
} from "../schemas/messageTemplate.schema";
import {
  DEFAULT_EMAIL_CHROME,
  EmailChrome,
  mergeEmailChrome,
  sanitizeEmailBody,
  sanitizeEmailChrome,
} from "../utils/emailChrome";

function resolveTemplateType(
  value: unknown,
): MessageTemplateType {
  return value === "email" ? "email" : "sms";
}

function toPublic(doc: IMessageTemplate | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IMessageTemplate).toObject()
      : (doc as Record<string, unknown>);

  const templateType = resolveTemplateType(d.templateType);

  return {
    _id: d._id,
    name: d.name,
    slug: d.slug,
    body: d.body ?? "",
    subject: templateType === "email" ? (d.subject ?? "") : "",
    templateType,
    emailChrome:
      templateType === "email"
        ? mergeEmailChrome((d.emailChrome as EmailChrome | null) ?? undefined)
        : undefined,
    deletedAt: d.deletedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function applyTypeFields(
  templateType: MessageTemplateType,
  body: string,
  subject: string,
  emailChrome?: EmailChrome,
): {
  body: string;
  subject: string;
  templateType: MessageTemplateType;
  emailChrome?: EmailChrome;
} {
  if (templateType === "sms") {
    return { templateType, body, subject: "" };
  }
  return {
    templateType,
    body: sanitizeEmailBody(body),
    subject,
    emailChrome: sanitizeEmailChrome(
      mergeEmailChrome(emailChrome ?? DEFAULT_EMAIL_CHROME),
    ),
  };
}

// GET /message-templates
export async function getMessageTemplates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const includeDeleted =
      req.query.includeDeleted === "1" || req.query.includeDeleted === "true";

    const filter: Record<string, unknown> = includeDeleted
      ? {}
      : { deletedAt: null };

    const typeRaw = String(req.query.templateType ?? "").trim();
    if (typeRaw === "email") {
      filter.templateType = "email";
    } else if (typeRaw === "sms") {
      filter.$or = [
        { templateType: "sms" },
        { templateType: { $exists: false } },
        { templateType: null },
      ];
    }

    const templates = await MessageTemplate.find(filter)
      .sort({ name: 1 })
      .lean();

    res.json({ templates: templates.map(toPublic) });
  } catch (err) {
    console.error("GET /message-templates error:", err);
    res.status(500).json({ message: "Failed to fetch message templates" });
  }
}

// GET /message-templates/:id
export async function getMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await MessageTemplate.findById(req.params.id).lean();
    if (!template || template.deletedAt) {
      res.status(404).json({ message: "Message template not found" });
      return;
    }
    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("GET /message-templates/:id error:", err);
    res.status(500).json({ message: "Failed to fetch message template" });
  }
}

// POST /message-templates
export async function createMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createMessageTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const templateType = resolveTemplateType(data.templateType);
    const fields = applyTypeFields(
      templateType,
      data.body ?? "",
      data.subject ?? "",
      data.emailChrome,
    );
    const slug =
      data.slug ??
      (await uniqueMessageTemplateSlug(
        slugifyMessageTemplateName(data.name) || "message",
      ));

    const existing = await MessageTemplate.findOne({ slug });
    if (existing) {
      if (existing.deletedAt) {
        existing.deletedAt = null;
        existing.name = data.name;
        existing.body = fields.body;
        existing.subject = fields.subject;
        existing.templateType = fields.templateType;
        existing.emailChrome = fields.emailChrome ?? null;
        await existing.save();
        res.status(200).json({ template: toPublic(existing) });
        return;
      }
      res.status(409).json({
        message: "A message template with that slug already exists",
      });
      return;
    }

    const template = await MessageTemplate.create({
      name: data.name,
      slug,
      body: fields.body,
      subject: fields.subject,
      templateType: fields.templateType,
      emailChrome: fields.emailChrome,
      deletedAt: null,
    });

    res.status(201).json({ template: toPublic(template) });
  } catch (err) {
    console.error("POST /message-templates error:", err);
    res.status(500).json({ message: "Failed to create message template" });
  }
}

// PATCH /message-templates/:id
export async function updateMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateMessageTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await MessageTemplate.findById(req.params.id);
    if (!template || template.deletedAt) {
      res.status(404).json({ message: "Message template not found" });
      return;
    }

    const nextType = resolveTemplateType(
      parsed.data.templateType ?? template.templateType,
    );
    const nextBody = parsed.data.body ?? template.body ?? "";
    if (nextType === "sms" && nextBody.length > SMS_BODY_MAX) {
      res.status(400).json({
        message: "Validation failed",
        errors: {
          body: [`Body must be at most ${SMS_BODY_MAX} characters`],
        },
      });
      return;
    }

    if (parsed.data.name !== undefined) template.name = parsed.data.name;
    template.templateType = nextType;
    template.body =
      nextType === "email" ? sanitizeEmailBody(nextBody) : nextBody;
    if (nextType === "sms") {
      template.subject = "";
      template.emailChrome = undefined;
    } else {
      if (parsed.data.subject !== undefined) {
        template.subject = parsed.data.subject;
      }
      template.emailChrome = sanitizeEmailChrome(
        mergeEmailChrome(
          parsed.data.emailChrome ??
            template.emailChrome ??
            DEFAULT_EMAIL_CHROME,
        ),
      );
    }

    await template.save();

    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("PATCH /message-templates/:id error:", err);
    res.status(500).json({ message: "Failed to update message template" });
  }
}

// DELETE /message-templates/:id (soft delete)
export async function deleteMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await MessageTemplate.findById(req.params.id);
    if (!template || template.deletedAt) {
      res.status(404).json({ message: "Message template not found" });
      return;
    }

    template.deletedAt = new Date();
    await template.save();

    res.json({ message: "Message template deleted" });
  } catch (err) {
    console.error("DELETE /message-templates error:", err);
    res.status(500).json({ message: "Failed to delete message template" });
  }
}
