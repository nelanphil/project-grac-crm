import { Response } from "express";
import twilio from "twilio";
import { Types } from "mongoose";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import { CustomerContact, activeContactFilter } from "../models/mongo/CustomerContact";
import { InboxConversation } from "../models/mongo/InboxConversation";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import { VoiceCallIntent } from "../models/mongo/VoiceCallIntent";
import { decryptCredential } from "../utils/credentialsCrypto";
import {
  inboxPhoneHandle,
  touchInboxConversation,
} from "../services/inboxConversation.service";
import {
  getTwilioAccountForSend,
  TwilioServiceError,
} from "../services/twilio.service";
import { normalizePhoneLines, phoneLinesMatch } from "../utils/twilioPhoneLines";
import { toE164 } from "../utils/messagingContext";
import {
  resolveOrCreateOpenThreadForOutbound,
  resolveThreadForInbound,
} from "../utils/messageThreads";
import { VOICE_INTENT_TTL_MS, voiceIdentity } from "../utils/voiceIntent";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const startCallSchema = z
  .object({
    contactId: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    conversationId: z.string().trim().optional(),
    twilioAccountId: z.string().trim().optional(),
    fromNumber: z.string().trim().optional(),
  })
  .refine((value) => value.contactId || value.phone || value.conversationId, {
    message: "Choose a contact or enter a phone number",
  });

function voiceLines(account: { phoneNumbers?: unknown }) {
  return normalizePhoneLines(account.phoneNumbers).filter(
    (line) => line.voice && line.phoneNumber,
  );
}

function pickVoiceFrom(
  account: { phoneNumbers?: unknown },
  requested?: string,
): string {
  const lines = voiceLines(account);
  if (lines.length === 0) {
    throw new TwilioServiceError(
      "This Twilio account has no voice-enabled phone numbers",
    );
  }
  if (!requested) return lines[0].phoneNumber;
  const match = lines.find((line) => phoneLinesMatch(line.phoneNumber, requested));
  if (!match) {
    throw new TwilioServiceError("That line cannot place voice calls");
  }
  return match.phoneNumber;
}

function browserCallingReady(account: {
  voiceApiKeySid?: string;
  voiceApiKeySecretEncrypted?: string;
  voiceTwimlAppSid?: string;
}): boolean {
  return Boolean(
    account.voiceApiKeySid &&
      account.voiceApiKeySecretEncrypted &&
      account.voiceTwimlAppSid,
  );
}

export async function getVoiceToken(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const requested =
      typeof req.query.twilioAccountId === "string" ? req.query.twilioAccountId : undefined;
    const account = requested
      ? await getTwilioAccountForSend(requested)
      : await TwilioAccount.findOne({
          isActive: true,
          voiceApiKeySid: { $nin: ["", null] },
          voiceTwimlAppSid: { $nin: ["", null] },
        }).sort({ friendlyName: 1 });
    if (!account || !browserCallingReady(account)) {
      res.status(400).json({
        message: "Enable browser calling on a Twilio account before placing a call.",
      });
      return;
    }

    const identity = voiceIdentity(req.user.id);
    const token = new AccessToken(
      account.accountSid,
      account.voiceApiKeySid,
      decryptCredential(account.voiceApiKeySecretEncrypted),
      { identity, ttl: 3600 },
    );
    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: account.voiceTwimlAppSid,
        incomingAllow: false,
      }),
    );
    res.json({
      token: token.toJwt(),
      identity,
      twilioAccountId: String(account._id),
      expiresIn: 3600,
    });
  } catch (err) {
    if (err instanceof TwilioServiceError) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error("GET /voice/token error:", err);
    res.status(500).json({ message: "Failed to create a calling token" });
  }
}

export async function startVoiceCall(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.id || !Types.ObjectId.isValid(req.user.id)) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const parsed = startCallSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const data = parsed.data;
    let phone = data.phone?.trim() || "";
    let contactRef: Types.ObjectId | null = null;
    let customerRef: Types.ObjectId | null = null;
    let displayName = "";

    if (data.contactId) {
      if (!Types.ObjectId.isValid(data.contactId)) {
        res.status(400).json({ message: "Invalid contact id" });
        return;
      }
      const contact = await CustomerContact.findOne({
        _id: data.contactId,
        ...activeContactFilter,
      });
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      phone = contact.phone || phone;
      contactRef = contact._id;
      customerRef = contact.customerRef;
      displayName = [contact.first, contact.last].filter(Boolean).join(" ").trim();
    }

    if (data.conversationId) {
      if (!Types.ObjectId.isValid(data.conversationId)) {
        res.status(400).json({ message: "Invalid conversation id" });
        return;
      }
      const existing = await InboxConversation.findOne({
        _id: data.conversationId,
        deletedAt: null,
      });
      if (!existing) {
        res.status(404).json({ message: "Conversation not found" });
        return;
      }
      if (!phone && existing.handleKind === "phone") phone = existing.handle;
      if (!customerRef && existing.customerRef) customerRef = existing.customerRef;
      if (!displayName) displayName = existing.displayName || "";
    }

    const to = toE164(phone);
    if (!to) {
      res.status(400).json({ message: "Enter a valid phone number" });
      return;
    }

    const account = await getTwilioAccountForSend(data.twilioAccountId);
    if (!browserCallingReady(account)) {
      res.status(400).json({
        message: "Enable browser calling on this Twilio account before placing a call.",
      });
      return;
    }
    const from = pickVoiceFrom(account, data.fromNumber);
    const userId = req.user.id;

    const thread = contactRef
      ? await resolveOrCreateOpenThreadForOutbound({
          contactRef,
          customerRef,
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          ourNumber: from,
          userId,
        })
      : await resolveThreadForInbound({
          contactRef: null,
          customerRef: null,
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          ourNumber: from,
          contactPhoneSnapshot: phone,
        });

    const conversation = await touchInboxConversation({
      customerRef,
      handle: inboxPhoneHandle(to),
      handleKind: "phone",
      at: new Date(),
      preview: "Outbound call",
      channel: "voice",
      direction: "outbound",
      ourNumber: from,
      countUnread: false,
      publish: true,
      actorUserId: userId,
      displayName,
    });
    if (!conversation) {
      res.status(400).json({ message: "Could not open a conversation for this number" });
      return;
    }

    const intent = await VoiceCallIntent.create({
      userRef: userId,
      twilioAccountRef: account._id,
      accountSid: account.accountSid,
      fromNumber: from,
      toNumber: to,
      contactRef,
      customerRef,
      threadRef: thread._id,
      conversationRef: conversation._id,
      twilioCallSid: "",
      expiresAt: new Date(Date.now() + VOICE_INTENT_TTL_MS),
    });

    res.status(201).json({
      intentId: String(intent._id),
      conversationId: String(conversation._id),
      twilioAccountId: String(account._id),
      fromNumber: from,
      toNumber: to,
    });
  } catch (err) {
    if (err instanceof TwilioServiceError) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error("POST /voice/calls error:", err);
    res.status(500).json({ message: "Failed to start the call" });
  }
}
