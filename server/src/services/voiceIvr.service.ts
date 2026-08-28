import mongoose, { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import { User } from "../models/mongo/User";
import {
  VoiceIvrSession,
  IVoiceIvrSession,
} from "../models/mongo/VoiceIvrSession";
import { findContactByPhone } from "../utils/communicationFormat";
import { normalizePhoneDigits } from "../utils/customerSites";
import {
  buildGatherTwiml,
  buildSayHangupTwiml,
  buildTakeAMessageTwiml,
} from "../utils/twilioVoiceTwiml";
import { resolveSayVoice } from "../utils/twilioVoices";
import { addMinutes } from "../utils/scheduleTime";
import {
  normalizeThreadPhone,
  resolveThreadForInbound,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import { toE164 } from "../utils/messagingContext";
import {
  voiceGatherWebhookAbsoluteUrl,
  voiceRecordingWebhookAbsoluteUrl,
} from "./twilio.service";
import {
  listNextAvailableSlots,
  staffDisplayName,
} from "./schedule.service";
import { nextPrefixedNumber } from "./serviceTicket";
import { resolveTicketSnapshot } from "./applyTicketFields";

const SESSION_MS = 30 * 60 * 1000;
const PREVIEW_LENGTH = 160;

function expiresAt(): Date {
  return new Date(Date.now() + SESSION_MS);
}

function gatherUrl(accountSid: string): string {
  return voiceGatherWebhookAbsoluteUrl(accountSid);
}

function voicemailTwiml(account: ITwilioAccount): string {
  return buildTakeAMessageTwiml(
    voiceRecordingWebhookAbsoluteUrl(account.accountSid),
    resolveSayVoice(account.sayVoice),
  );
}

function parseSpokenName(raw: string): { first: string; last: string } {
  const cleaned = raw
    .replace(/[^a-zA-Z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { first: "Caller", last: "" };
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function nextCustomerLegacyId(): Promise<number> {
  const maxLegacy = await Customer.findOne()
    .sort({ legacyId: -1 })
    .select("legacyId")
    .lean();
  return (maxLegacy?.legacyId ?? 0) + 1;
}

async function loadContactFirstName(
  contactRef: Types.ObjectId | null | undefined,
): Promise<string> {
  if (!contactRef) return "";
  const contact = await CustomerContact.findById(contactRef)
    .select("first")
    .lean();
  return (contact?.first ?? "").trim();
}

function digitChoice(params: Record<string, string>): string {
  return (params.Digits || params.dtmf || "").trim();
}

async function offerSlotsTwiml(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  intro: string,
): Promise<string> {
  const slots = await listNextAvailableSlots({
    estimatedMinutes: 60,
    count: 3,
    daysAhead: 14,
  });
  session.offeredSlots = slots.map((s) => ({
    start: s.start,
    end: s.end,
    assignedUserRef: s.assignedUserRef,
    spokenLabel: s.spokenLabel,
  }));
  session.step = "offer_slots";
  session.expiresAt = expiresAt();
  await session.save();

  const voice = resolveSayVoice(account.sayVoice);
  const action = gatherUrl(account.accountSid);

  if (slots.length === 0) {
    return buildGatherTwiml({
      prompt: `${intro} I don't have any open appointment times right now. Press 2 to leave a message and we will call you back.`,
      actionUrl: action,
      voice,
      numDigits: 1,
    });
  }

  const options = slots
    .map((s, i) => `Press ${i + 1} for ${s.spokenLabel}.`)
    .join(" ");
  return buildGatherTwiml({
    prompt: `${intro} ${options} Press 2 to leave a message instead.`,
    actionUrl: action,
    voice,
    numDigits: 1,
  });
}

export async function startInboundIvr(opts: {
  account: ITwilioAccount;
  callSid: string;
  fromNumber: string;
  toNumber: string;
}): Promise<string> {
  const matched = opts.fromNumber
    ? await findContactByPhone(opts.fromNumber)
    : null;
  const first = matched
    ? await loadContactFirstName(matched.contactRef)
    : "";

  await VoiceIvrSession.findOneAndUpdate(
    { callSid: opts.callSid },
    {
      $set: {
        accountSid: opts.account.accountSid,
        step: "menu",
        fromNumber: opts.fromNumber,
        toNumber: opts.toNumber,
        customerRef: matched?.customerRef ?? null,
        contactRef: matched?.contactRef ?? null,
        isNewCustomer: !matched,
        speechName: "",
        offeredSlots: [],
        selectedSlotIndex: null,
        expiresAt: expiresAt(),
      },
    },
    { upsert: true, new: true },
  );

  const voice = resolveSayVoice(opts.account.sayVoice);
  const action = gatherUrl(opts.account.accountSid);

  if (matched) {
    const greet = first
      ? `Hi ${first}, thanks for calling GRAC.`
      : "Thanks for calling GRAC.";
    return buildGatherTwiml({
      prompt: `${greet} Press 1 to book a service appointment. Press 2 to leave a message.`,
      actionUrl: action,
      voice,
      numDigits: 1,
    });
  }

  return buildGatherTwiml({
    prompt:
      "Thanks for calling GRAC. Press 1 to book an appointment as a new customer. Press 2 to leave a message.",
    actionUrl: action,
    voice,
    numDigits: 1,
  });
}

async function createTempCustomerFromCall(opts: {
  fromNumber: string;
  first: string;
  last: string;
}): Promise<{ customerRef: Types.ObjectId; contactRef: Types.ObjectId }> {
  const phone = opts.fromNumber;
  const phoneDigits = normalizePhoneDigits(phone);
  const legacyId = await nextCustomerLegacyId();
  const accountName = `${opts.first} ${opts.last}`.trim() || "New caller";

  const customer = await Customer.create({
    legacyId,
    userId: 0,
    accountName,
    first: opts.first,
    last: opts.last,
    phone,
    phoneDigits,
    email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    county: "",
    ownerUserRef: null,
    deletedAt: null,
    isTemporary: true,
  });

  const contact = await CustomerContact.create({
    customerRef: customer._id,
    first: opts.first,
    last: opts.last,
    phone,
    email: "",
    label: "Primary",
    isPrimary: true,
    legacyCustomerId: legacyId,
  });

  return { customerRef: customer._id, contactRef: contact._id };
}

async function attachCallToCustomer(opts: {
  account: ITwilioAccount;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  customerRef: Types.ObjectId;
  contactRef: Types.ObjectId;
  summary?: string;
}): Promise<void> {
  const ourNumber = toE164(opts.toNumber) ?? opts.toNumber;
  const thread = await resolveThreadForInbound({
    contactRef: opts.contactRef,
    customerRef: opts.customerRef,
    twilioAccountRef: opts.account._id,
    accountSid: opts.account.accountSid,
    ourNumber,
    contactPhoneSnapshot: normalizeThreadPhone(opts.fromNumber),
  });

  const summary = (opts.summary ?? "").trim();
  await TwilioCommunication.updateOne(
    { accountSid: opts.account.accountSid, twilioSid: opts.callSid },
    {
      $set: {
        customerRef: opts.customerRef,
        contactRef: opts.contactRef,
        threadRef: thread._id,
        ...(summary
          ? { body: summary.slice(0, PREVIEW_LENGTH), transcript: summary }
          : {}),
      },
    },
  );

  if (summary) {
    await touchThreadAfterMessage(thread._id, {
      direction: "inbound",
      channel: "voice",
      body: summary,
      transcript: summary,
      at: new Date(),
    });
  }
}

async function bookSelectedSlot(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
): Promise<string> {
  const index = session.selectedSlotIndex ?? 0;
  const slot = session.offeredSlots[index];
  const voice = resolveSayVoice(account.sayVoice);
  if (!slot || !session.customerRef || !session.contactRef) {
    return voicemailTwiml(account);
  }
  if (!mongoose.Types.ObjectId.isValid(slot.assignedUserRef)) {
    return voicemailTwiml(account);
  }

  const customer = await Customer.findById(session.customerRef);
  if (!customer || customer.legacyId == null) {
    return buildSayHangupTwiml(
      "I'm sorry, I couldn't complete that booking. Please leave a message after the tone.",
      voice,
    );
  }

  try {
    const snapshot = await resolveTicketSnapshot({ customer });
    const tech = await User.findById(slot.assignedUserRef)
      .select("first_name last_name")
      .lean();
    const techName = tech ? staffDisplayName(tech) : "";
    const start = new Date(slot.start);
    const end = slot.end
      ? new Date(slot.end)
      : addMinutes(start, 60);

    const workOrder = new WorkOrder({
      customerId: customer.legacyId,
      customerRef: customer._id,
      userId: 0,
      number: await nextPrefixedNumber(WorkOrder, "WO"),
      estimatedMinutes: 60,
      descPerform: "Booked by inbound phone",
      assignedUserRef: new mongoose.Types.ObjectId(slot.assignedUserRef),
      scheduledStart: start,
      scheduledEnd: end,
      tech: techName,
      date: start,
      customerName: snapshot.customerName,
      customerAddress: snapshot.customerAddress,
      customerCity: snapshot.customerCity,
      customerZip: snapshot.customerZip,
      customerPhone: snapshot.customerPhone || session.fromNumber,
      customerEmail: snapshot.customerEmail,
    });
    await workOrder.save();

    await attachCallToCustomer({
      account,
      callSid: session.callSid,
      fromNumber: session.fromNumber,
      toNumber: session.toNumber,
      customerRef: session.customerRef,
      contactRef: session.contactRef,
      summary: `You're booked for ${slot.spokenLabel}. Work order ${workOrder.number}.`,
    });

    return buildSayHangupTwiml(
      `You're booked for ${slot.spokenLabel}. A technician will be assigned. Goodbye.`,
      voice,
    );
  } catch (err) {
    console.error("Inbound IVR booking failed:", err);
    return buildSayHangupTwiml(
      "I'm sorry, I couldn't complete that booking. Please leave a message after the tone.",
      voice,
    );
  }
}

export async function handleIvrGather(opts: {
  account: ITwilioAccount;
  params: Record<string, string>;
}): Promise<string> {
  const callSid = opts.params.CallSid || opts.params.ParentCallSid || "";
  const voice = resolveSayVoice(opts.account.sayVoice);
  const action = gatherUrl(opts.account.accountSid);
  const digits = digitChoice(opts.params);
  const speech = (opts.params.SpeechResult || "").trim();

  if (!callSid) {
    return voicemailTwiml(opts.account);
  }

  const session = await VoiceIvrSession.findOne({ callSid });
  if (!session) {
    return startInboundIvr({
      account: opts.account,
      callSid,
      fromNumber: opts.params.From || "",
      toNumber: opts.params.To || "",
    });
  }

  if (digits === "2" || digits === "0") {
    return voicemailTwiml(opts.account);
  }

  if (session.step === "gather_name") {
    const spoken = speech || digits;
    if (!spoken) {
      if (session.speechName === "(retry)") {
        return voicemailTwiml(opts.account);
      }
      session.speechName = "(retry)";
      session.expiresAt = expiresAt();
      await session.save();
      return buildGatherTwiml({
        prompt: "I didn't catch your name. Please say your first and last name.",
        actionUrl: action,
        voice,
        speech: true,
        timeout: 4,
      });
    }
    const { first, last } = parseSpokenName(spoken);
    session.speechName = `${first} ${last}`.trim();
    const created = await createTempCustomerFromCall({
      fromNumber: session.fromNumber || opts.params.From || "",
      first,
      last,
    });
    session.customerRef = created.customerRef;
    session.contactRef = created.contactRef;
    session.isNewCustomer = true;
    await session.save();
    await attachCallToCustomer({
      account: opts.account,
      callSid,
      fromNumber: session.fromNumber,
      toNumber: session.toNumber,
      customerRef: created.customerRef,
      contactRef: created.contactRef,
    });
    return offerSlotsTwiml(
      session,
      opts.account,
      `Thanks ${first}. Let's find an appointment.`,
    );
  }

  if (!digits) {
    return voicemailTwiml(opts.account);
  }

  if (session.step === "menu") {
    if (digits === "1") {
      if (session.customerRef && session.contactRef) {
        return offerSlotsTwiml(session, opts.account, "Great.");
      }
      session.step = "gather_name";
      session.expiresAt = expiresAt();
      await session.save();
      return buildGatherTwiml({
        prompt: "Please say your first and last name after the tone.",
        actionUrl: action,
        voice,
        speech: true,
        timeout: 4,
      });
    }
    return buildGatherTwiml({
      prompt:
        "Press 1 to book a service appointment. Press 2 to leave a message.",
      actionUrl: action,
      voice,
      numDigits: 1,
    });
  }

  if (session.step === "offer_slots") {
    const choice = parseInt(digits, 10);
    if (choice >= 1 && choice <= session.offeredSlots.length) {
      session.selectedSlotIndex = choice - 1;
      session.step = "confirm_slot";
      session.expiresAt = expiresAt();
      await session.save();
      const slot = session.offeredSlots[choice - 1];
      return buildGatherTwiml({
        prompt: `You selected ${slot.spokenLabel}. Press 1 to confirm, or 2 to leave a message.`,
        actionUrl: action,
        voice,
        numDigits: 1,
      });
    }
    return offerSlotsTwiml(
      session,
      opts.account,
      "Please choose one of the times.",
    );
  }

  if (session.step === "confirm_slot") {
    if (digits === "1") {
      return bookSelectedSlot(session, opts.account);
    }
    return offerSlotsTwiml(session, opts.account, "No problem.");
  }

  return voicemailTwiml(opts.account);
}
