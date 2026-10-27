import { Types } from "mongoose";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { InboxConversation } from "../models/mongo/InboxConversation";
import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import { inboxPhoneHandle } from "./inboxConversation.service";
import { handleMissedInboundCall } from "./missedCall.service";
import {
  voiceBrowserRecordingPath,
  voiceInboundAnsweredPath,
  voiceInboundCompletePath,
} from "./twilio.service";
import { findVoiceCommunication } from "./twilioInboundIngest.service";
import { appendVoiceActivity, voicemailTwiml } from "./voiceIvr.service";
import { listOnlineVoiceAgents } from "./voicePresence.service";
import { buildRingAgentsTwiml } from "../utils/twilioVoiceTwiml";
import { normalizePhoneLines, phoneLinesMatch } from "../utils/twilioPhoneLines";

const MISSED_INTRO = "Sorry we missed your call.";

async function conversationForCaller(input: {
  customerRef?: Types.ObjectId | null;
  fromNumber: string;
}): Promise<{ id: string; displayName: string }> {
  const handle = inboxPhoneHandle(input.fromNumber);
  const convo = input.customerRef
    ? await InboxConversation.findOne({ customerRef: input.customerRef })
        .select("displayName")
        .lean()
    : handle
      ? await InboxConversation.findOne({
          customerRef: null,
          handle,
          handleKind: "phone",
        })
          .select("displayName")
          .lean()
      : null;
  return {
    id: convo ? String(convo._id) : "",
    displayName: (convo?.displayName || "").trim(),
  };
}

async function callerCard(
  account: ITwilioAccount,
  callSid: string,
  fromNumber: string,
  toNumber: string,
): Promise<{
  callerName: string;
  callerNumber: string;
  lineLabel: string;
  conversationId: string;
}> {
  const doc = callSid
    ? await findVoiceCommunication(account.accountSid, [callSid])
    : null;
  let callerName = "";
  if (doc?.contactRef) {
    const contact = await CustomerContact.findById(doc.contactRef)
      .select("first last")
      .lean();
    callerName = [contact?.first, contact?.last].filter(Boolean).join(" ").trim();
  }
  const conversation = await conversationForCaller({
    customerRef: doc?.customerRef,
    fromNumber,
  });
  if (!callerName) callerName = conversation.displayName;
  const line = normalizePhoneLines(account.phoneNumbers).find((entry) =>
    phoneLinesMatch(entry.phoneNumber, toNumber),
  );
  return {
    callerName: callerName || "Unknown",
    callerNumber: fromNumber || "Unknown",
    lineLabel:
      line?.label || line?.twilioFriendlyName || account.friendlyName || "Line",
    conversationId: conversation.id,
  };
}

/** Ring online browsers, or go straight to voicemail when nobody is signed in. */
export async function inboundCallTwiml(opts: {
  account: ITwilioAccount;
  callSid: string;
  fromNumber: string;
  toNumber: string;
}): Promise<string> {
  const agents = await listOnlineVoiceAgents(opts.account.accountSid);
  if (agents.length === 0) {
    try {
      await handleMissedInboundCall({
        account: opts.account,
        callSid: opts.callSid,
        fromNumber: opts.fromNumber,
        toNumber: opts.toNumber,
      });
    } catch (err) {
      console.error("[voice] missed-call text failed:", err);
    }
    return voicemailTwiml(opts.account, MISSED_INTRO);
  }

  const card = await callerCard(
    opts.account,
    opts.callSid,
    opts.fromNumber,
    opts.toNumber,
  );
  await appendVoiceActivity({
    accountSid: opts.account.accountSid,
    callSid: opts.callSid,
    line: "Ringing the team.",
  });
  return buildRingAgentsTwiml({
    agents,
    actionUrl: voiceInboundCompletePath(opts.account.accountSid),
    answeredUrlFor: (userId) =>
      voiceInboundAnsweredPath(opts.account.accountSid, userId),
    recordingStatusCallbackUrl: voiceBrowserRecordingPath(opts.account.accountSid),
    callerName: card.callerName,
    callerNumber: card.callerNumber,
    lineLabel: card.lineLabel,
    conversationId: card.conversationId,
  });
}
