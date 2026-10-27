import twilio from "twilio";
import { ITwilioAccount, TwilioAccount } from "../models/mongo/TwilioAccount";
import {
  ITwilioCommunication,
  TwilioCommunication,
} from "../models/mongo/TwilioCommunication";
import { Customer } from "../models/mongo/Customer";
import { getAccountAuthToken } from "./twilio.service";
import { touchFromTwilio } from "./inboxConversation.service";
import { formatCallTranscript } from "../utils/callTranscriptFormat";
import { summarizeCall } from "./grokCallSummary.service";

export function intelligenceWebhookUrl(base: string, accountSid: string): string {
  return `${base.replace(/\/+$/, "")}/webhooks/twilio/intelligence?accountSid=${encodeURIComponent(accountSid)}`;
}

export async function ensureVoiceIntelligenceService(
  account: ITwilioAccount,
  base: string,
): Promise<string> {
  const client = twilio(account.accountSid, getAccountAuthToken(account));
  const webhookUrl = intelligenceWebhookUrl(base, account.accountSid);
  const uniqueName = `grac-calls-${account.accountSid.slice(-10).toLowerCase()}`;
  if (account.voiceIntelligenceServiceSid) {
    await client.intelligence.v2.services(account.voiceIntelligenceServiceSid).update({
      webhookUrl,
      webhookHttpMethod: "POST",
    });
    return account.voiceIntelligenceServiceSid;
  }
  try {
    const created = await client.intelligence.v2.services.create({
      uniqueName,
      friendlyName: "GRAC call transcripts",
      webhookUrl,
      webhookHttpMethod: "POST",
    });
    account.voiceIntelligenceServiceSid = created.sid;
    return created.sid;
  } catch (err) {
    const listed = await client.intelligence.v2.services.list({ limit: 50 });
    const existing = listed.find((service) => service.uniqueName === uniqueName);
    if (!existing) throw err;
    await client.intelligence.v2.services(existing.sid).update({
      webhookUrl,
      webhookHttpMethod: "POST",
    });
    account.voiceIntelligenceServiceSid = existing.sid;
    return existing.sid;
  }
}

export async function startCallTranscript(
  account: ITwilioAccount,
  communication: ITwilioCommunication,
  recordingSid: string,
): Promise<void> {
  const recording = recordingSid.trim();
  if (!recording || !account.voiceIntelligenceServiceSid) return;
  if (communication.intelligenceTranscriptSid) return;
  try {
    const client = twilio(account.accountSid, getAccountAuthToken(account));
    const created = await client.intelligence.v2.transcripts.create({
      serviceSid: account.voiceIntelligenceServiceSid,
      customerKey: String(communication._id),
      channel: { media_properties: { source_sid: recording } },
    });
    communication.intelligenceTranscriptSid = created.sid;
    communication.transcriptStatus = "pending";
    if (communication.transcript && !communication.transcriptSource) {
      communication.transcriptSource = "basic";
    }
    await communication.save();
  } catch (err) {
    communication.transcriptStatus = "failed";
    await communication.save();
    console.warn(
      "[voice] could not start transcription:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function completeCallTranscript(transcriptSid: string): Promise<void> {
  const sid = transcriptSid.trim();
  if (!sid) return;
  const communication = await TwilioCommunication.findOne({ intelligenceTranscriptSid: sid });
  if (!communication) return;
  const account = await TwilioAccount.findById(communication.twilioAccountRef);
  if (!account) return;
  try {
    const client = twilio(account.accountSid, getAccountAuthToken(account));
    const sentences = await client.intelligence.v2
      .transcripts(sid)
      .sentences.list({ limit: 1000 });
    const text = formatCallTranscript(
      sentences.map((sentence) => ({
        transcript: sentence.transcript,
        mediaChannel: sentence.mediaChannel,
        sentenceIndex: sentence.sentenceIndex,
      })),
      communication.direction === "outbound" ? "dual" : "single",
    );
    if (!text) {
      communication.transcriptStatus = communication.transcript ? "completed" : "failed";
      await communication.save();
      return;
    }
    communication.transcript = text;
    communication.transcriptSource = "intelligence";
    communication.transcriptStatus = "completed";
    const customer = communication.customerRef
      ? await Customer.findById(communication.customerRef).select("accountName first last").lean()
      : null;
    const customerName = customer
      ? String(customer.accountName || `${customer.first || ""} ${customer.last || ""}`).trim()
      : "";
    const summary = await summarizeCall(text, customerName);
    if (summary) {
      communication.callSummary = summary.summary;
      if (summary.task.needed && summary.task.title) {
        communication.suggestedTask = {
          title: summary.task.title,
          description: summary.task.description,
          dueInDays: summary.task.dueInDays,
        };
      }
    }
    await communication.save();
    await touchFromTwilio(communication, {
      countUnread: false,
      publish: true,
      actorUserId: communication.createdByUserRef ? String(communication.createdByUserRef) : null,
    });
  } catch (err) {
    communication.transcriptStatus = "failed";
    await communication.save().catch(() => undefined);
    console.warn(
      "[voice] transcription failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
