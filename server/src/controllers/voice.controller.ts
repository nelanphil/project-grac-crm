import { Response } from "express";
import twilio from "twilio";
import { Types } from "mongoose";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import { CustomerContact, activeContactFilter } from "../models/mongo/CustomerContact";
import { InboxConversation } from "../models/mongo/InboxConversation";
import { ITwilioAccount, TwilioAccount } from "../models/mongo/TwilioAccount";
import { VoiceAgentPresence } from "../models/mongo/VoiceAgentPresence";
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

const presenceSchema = z.object({
  accountSids: z.array(z.string().trim().min(1)).max(20),
});

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

function issueVoiceToken(account: ITwilioAccount, identity: string): string {
  const token = new AccessToken(
    account.accountSid,
    account.voiceApiKeySid,
    decryptCredential(account.voiceApiKeySecretEncrypted),
    { identity, ttl: 3600 },
  );
  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: account.voiceTwimlAppSid,
      incomingAllow: true,
    }),
  );
  return token.toJwt();
}

async function browserCallingAccounts(accountSids?: string[]) {
  const filter: Record<string, unknown> = {
    isActive: true,
    voiceApiKeySid: { $nin: ["", null] },
    voiceTwimlAppSid: { $nin: ["", null] },
  };
  if (accountSids) filter.accountSid = { $in: accountSids };
  const accounts = await TwilioAccount.find(filter).sort({ friendlyName: 1 });
  return accounts.filter((account) => browserCallingReady(account));
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
    res.json({
      token: issueVoiceToken(account, identity),
      identity,
      twilioAccountId: String(account._id),
      accountSid: account.accountSid,
      friendlyName: account.friendlyName,
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

// GET /voice/tokens — one incoming-capable token per browser-calling account.
export async function getVoiceTokens(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const identity = voiceIdentity(req.user.id);
    const accounts = await browserCallingAccounts();
    const tokens: Array<{
      token: string;
      identity: string;
      twilioAccountId: string;
      accountSid: string;
      friendlyName: string;
      expiresIn: number;
    }> = [];
    for (const account of accounts) {
      try {
        tokens.push({
          token: issueVoiceToken(account, identity),
          identity,
          twilioAccountId: String(account._id),
          accountSid: account.accountSid,
          friendlyName: account.friendlyName,
          expiresIn: 3600,
        });
      } catch (err) {
        console.error(`[voice] skipped token for ${account.accountSid}:`, err);
      }
    }
    res.json({ tokens });
  } catch (err) {
    console.error("GET /voice/tokens error:", err);
    res.status(500).json({ message: "Failed to create calling tokens" });
  }
}

// POST /voice/presence — heartbeat from a signed-in browser.
export async function postVoicePresence(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.id || !Types.ObjectId.isValid(req.user.id)) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const parsed = presenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }
    const userRef = new Types.ObjectId(req.user.id);
    const identity = voiceIdentity(req.user.id);
    const accounts = await browserCallingAccounts(parsed.data.accountSids);
    const sids = accounts.map((account) => account.accountSid);
    await VoiceAgentPresence.deleteMany({
      userRef,
      accountSid: { $nin: sids },
    });
    const now = new Date();
    if (sids.length > 0) {
      await VoiceAgentPresence.bulkWrite(
        sids.map((accountSid) => ({
          updateOne: {
            filter: { userRef, accountSid },
            update: { $set: { identity, lastSeenAt: now } },
            upsert: true,
          },
        })),
      );
    }
    res.json({ ok: true, lastSeenAt: now.toISOString() });
  } catch (err) {
    console.error("POST /voice/presence error:", err);
    res.status(500).json({ message: "Failed to update calling presence" });
  }
}

// DELETE /voice/presence — browser signed out or closed.
export async function deleteVoicePresence(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.id || !Types.ObjectId.isValid(req.user.id)) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const beforeRaw = typeof req.query.before === "string" ? req.query.before : "";
    const before = beforeRaw ? new Date(beforeRaw) : null;
    const filter: Record<string, unknown> = {
      userRef: new Types.ObjectId(req.user.id),
    };
    if (before && !Number.isNaN(before.getTime())) {
      filter.lastSeenAt = { $lte: before };
    }
    await VoiceAgentPresence.deleteMany(filter);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /voice/presence error:", err);
    res.status(500).json({ message: "Failed to clear calling presence" });
  }
}
