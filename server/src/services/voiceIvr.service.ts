import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  VoiceIvrSession,
  IVoiceIvrSession,
  VoiceIvrStep,
} from "../models/mongo/VoiceIvrSession";
import { findContactByPhone } from "../utils/communicationFormat";
import {
  defaultAddressLabel,
  normalizePhoneDigits,
} from "../utils/customerSites";
import {
  buildGatherTwiml,
  buildSayHangupTwiml,
  buildTakeAMessageTwiml,
} from "../utils/twilioVoiceTwiml";
import { resolveSayVoice } from "../utils/twilioVoices";
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

const SESSION_MS = 30 * 60 * 1000;
const PREVIEW_LENGTH = 160;
const COMPANY_NAME = "Generator Maintenance of Florida";
const MENU_PROMPT =
  "Press 1 to schedule a service. Press 2 to leave a message.";
const WEEKDAY_HINTS =
  "Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday, weekdays, weekend";

const WEEKDAYS: Array<{ keys: string[]; label: string }> = [
  { keys: ["monday", "mondays"], label: "Monday" },
  { keys: ["tuesday", "tuesdays"], label: "Tuesday" },
  { keys: ["wednesday", "wednesdays"], label: "Wednesday" },
  { keys: ["thursday", "thursdays"], label: "Thursday" },
  { keys: ["friday", "fridays"], label: "Friday" },
  { keys: ["saturday", "saturdays"], label: "Saturday" },
  { keys: ["sunday", "sundays"], label: "Sunday" },
];

function expiresAt(): Date {
  return new Date(Date.now() + SESSION_MS);
}

function gatherUrl(accountSid: string): string {
  return voiceGatherWebhookAbsoluteUrl(accountSid);
}

export function voicemailTwiml(
  account: ITwilioAccount,
  intro?: string,
): string {
  return buildTakeAMessageTwiml(
    voiceRecordingWebhookAbsoluteUrl(account.accountSid),
    resolveSayVoice(account.sayVoice),
    intro,
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

export function parseSpokenAddress(raw: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const original = raw.replace(/\s+/g, " ").trim();
  if (!original) {
    return { street: "", city: "", state: "", zip: "" };
  }

  let text = original.replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();

  let zip = "";
  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) {
    zip = zipMatch[1];
    text = text.replace(zipMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  const states: Array<{ pattern: RegExp; abbrev: string }> = [
    { pattern: /\bflorida\b|\bfl\b/i, abbrev: "FL" },
    { pattern: /\bgeorgia\b|\bga\b/i, abbrev: "GA" },
    { pattern: /\balabama\b|\bal\b/i, abbrev: "AL" },
  ];
  let state = "";
  for (const entry of states) {
    if (entry.pattern.test(text)) {
      state = entry.abbrev;
      text = text.replace(entry.pattern, " ").replace(/\s+/g, " ").trim();
      break;
    }
  }

  let city = "";
  const inCity = text.match(/\bin\s+([a-zA-Z][a-zA-Z\s]*)$/i);
  if (inCity && inCity.index != null) {
    city = inCity[1].trim();
    text = text.slice(0, inCity.index).trim();
  } else if ((state || zip) && text) {
    const parts = text.split(" ");
    const streetSuffix =
      /^(street|st|road|rd|drive|dr|lane|ln|ave|avenue|blvd|boulevard|way|court|ct|circle|place|pl)$/i;
    if (parts.length >= 2 && !streetSuffix.test(parts[parts.length - 1] ?? "")) {
      city = parts.pop() ?? "";
      text = parts.join(" ");
    }
  }

  return {
    street: text || original,
    city,
    state,
    zip,
  };
}

export function parseSpokenDays(raw: string): string[] {
  const lower = raw.toLowerCase();
  if (
    /\bweekdays?\b/.test(lower) ||
    /\bany weekday\b/.test(lower)
  ) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  }
  if (/\bweekends?\b/.test(lower)) {
    return ["Saturday", "Sunday"];
  }
  if (
    /\bany day\b/.test(lower) ||
    /\bwhenever\b/.test(lower) ||
    /\ball (days|week)\b/.test(lower)
  ) {
    return [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
  }

  const found: string[] = [];
  for (const day of WEEKDAYS) {
    if (day.keys.some((key) => new RegExp(`\\b${key}\\b`, "i").test(lower))) {
      found.push(day.label);
    }
  }
  return found;
}

export function formatDaysSpoken(days: string[]): string {
  if (days.length === 0) return "";
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return `${days.slice(0, -1).join(", ")}, and ${days[days.length - 1]}`;
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

async function setStep(
  session: IVoiceIvrSession,
  step: VoiceIvrStep,
): Promise<void> {
  session.step = step;
  session.gatherRetries = 0;
  session.expiresAt = expiresAt();
  await session.save();
}

function daysGatherTwiml(account: ITwilioAccount, intro?: string): string {
  const prompt = intro
    ? `${intro} Which days of the week work best for a service visit?`
    : "Which days of the week work best for a service visit?";
  return buildGatherTwiml({
    prompt,
    actionUrl: gatherUrl(account.accountSid),
    voice: resolveSayVoice(account.sayVoice),
    speech: true,
    timeout: 6,
    hints: WEEKDAY_HINTS,
  });
}

function confirmDaysTwiml(account: ITwilioAccount, daysSpoken: string): string {
  return buildGatherTwiml({
    prompt: `I heard ${daysSpoken}. Press 1 if that is correct, or say the days again.`,
    actionUrl: gatherUrl(account.accountSid),
    voice: resolveSayVoice(account.sayVoice),
    speech: true,
    timeout: 6,
    hints: WEEKDAY_HINTS,
    numDigits: 1,
  });
}

async function nextCustomerFromCall(opts: {
  fromNumber: string;
  first: string;
  last: string;
  spokenAddress: string;
}): Promise<{ customerRef: Types.ObjectId; contactRef: Types.ObjectId }> {
  const phone = opts.fromNumber;
  const phoneDigits = normalizePhoneDigits(phone);
  const legacyId = await nextCustomerLegacyId();
  const accountName = `${opts.first} ${opts.last}`.trim() || "New caller";
  const parsed = parseSpokenAddress(opts.spokenAddress);
  const street = parsed.street || opts.spokenAddress.trim();

  const customer = await Customer.create({
    legacyId,
    userId: 0,
    accountName,
    first: opts.first,
    last: opts.last,
    phone,
    phoneDigits,
    email: "",
    address: street,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
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

  await CustomerAddress.create({
    customerRef: customer._id,
    label: defaultAddressLabel(parsed.city, street),
    address: street,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    county: "",
    countyManual: false,
    isPrimary: true,
    propertyType: "residential",
    legacyCustomerId: legacyId,
    lat: null,
    lng: null,
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

async function maybeAddPreferredDaysNote(
  customerRef: Types.ObjectId,
  daysSpoken: string,
): Promise<void> {
  const admin = await User.findOne({
    ...activeUserFilter,
    role: { $in: ["admin", "super-admin"] },
  })
    .select("_id")
    .lean();
  if (!admin?._id) return;

  try {
    await CustomerNote.create({
      customerRef,
      authorId: admin._id,
      content: `Phone IVR: prefers ${daysSpoken}.`,
    });
  } catch (err) {
    console.error("Inbound IVR customer note failed:", err);
  }
}

async function completeScheduleRequest(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  daysSpoken: string,
): Promise<string> {
  const voice = resolveSayVoice(account.sayVoice);
  const nameBit = session.speechName.trim();
  const addressBit = session.speechAddress.trim();
  const who =
    nameBit && addressBit
      ? `${nameBit} at ${addressBit}`
      : nameBit || "caller";
  const summary = session.isNewCustomer
    ? `Inbound call: ${who}. Requested service. Prefers ${daysSpoken}.`
    : `Inbound call: requested service. Prefers ${daysSpoken}.`;

  if (session.customerRef && session.contactRef) {
    try {
      await attachCallToCustomer({
        account,
        callSid: session.callSid,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber,
        customerRef: session.customerRef,
        contactRef: session.contactRef,
        summary,
      });
      await maybeAddPreferredDaysNote(session.customerRef, daysSpoken);
    } catch (err) {
      console.error("Inbound IVR schedule persist failed:", err);
    }
  }

  return buildSayHangupTwiml(
    "Thanks. We'll be in touch to schedule your service. Goodbye.",
    voice,
  );
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
        speechAddress: "",
        preferredDays: "",
        gatherRetries: 0,
        expiresAt: expiresAt(),
      },
      $unset: {
        offeredSlots: 1,
        selectedSlotIndex: 1,
      },
    },
    { upsert: true, new: true },
  );

  const greet = first
    ? `Hi ${first}, thanks for calling ${COMPANY_NAME}.`
    : `Thanks for calling ${COMPANY_NAME}.`;
  return buildGatherTwiml({
    prompt: `${greet} ${MENU_PROMPT}`,
    actionUrl: gatherUrl(opts.account.accountSid),
    voice: resolveSayVoice(opts.account.sayVoice),
    numDigits: 1,
  });
}

async function handleMenu(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  digits: string,
): Promise<string> {
  const voice = resolveSayVoice(account.sayVoice);
  const action = gatherUrl(account.accountSid);

  if (!digits || digits === "2" || digits === "0") {
    return voicemailTwiml(account);
  }

  if (digits === "1") {
    if (session.customerRef && session.contactRef) {
      await setStep(session, "gather_days");
      return daysGatherTwiml(account);
    }
    await setStep(session, "gather_name");
    return buildGatherTwiml({
      prompt: "Please say your first and last name.",
      actionUrl: action,
      voice,
      speech: true,
      timeout: 6,
    });
  }

  return buildGatherTwiml({
    prompt: MENU_PROMPT,
    actionUrl: action,
    voice,
    numDigits: 1,
  });
}

async function retryOrVoicemail(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  retryTwiml: string,
): Promise<string> {
  if (session.gatherRetries >= 1) {
    return voicemailTwiml(
      account,
      "I'm sorry, I still didn't catch that.",
    );
  }
  session.gatherRetries += 1;
  session.expiresAt = expiresAt();
  await session.save();
  return retryTwiml;
}

async function handleGatherName(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  spoken: string,
): Promise<string> {
  const voice = resolveSayVoice(account.sayVoice);
  const action = gatherUrl(account.accountSid);

  if (!spoken) {
    return retryOrVoicemail(
      session,
      account,
      buildGatherTwiml({
        prompt: "I didn't catch your name. Please say your first and last name.",
        actionUrl: action,
        voice,
        speech: true,
        timeout: 6,
      }),
    );
  }

  const { first, last } = parseSpokenName(spoken);
  session.speechName = `${first} ${last}`.trim();
  await setStep(session, "gather_address");
  return buildGatherTwiml({
    prompt:
      "Thanks. Please say the street address where we should perform service, including city and zip if you know them.",
    actionUrl: action,
    voice,
    speech: true,
    timeout: 7,
  });
}

async function handleGatherAddress(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  spoken: string,
): Promise<string> {
  const voice = resolveSayVoice(account.sayVoice);
  const action = gatherUrl(account.accountSid);

  if (!spoken) {
    return retryOrVoicemail(
      session,
      account,
      buildGatherTwiml({
        prompt:
          "I didn't catch the address. Please say the street address, including city and zip if you know them.",
        actionUrl: action,
        voice,
        speech: true,
        timeout: 7,
      }),
    );
  }

  session.speechAddress = spoken.replace(/\s+/g, " ").trim();
  const { first, last } = parseSpokenName(session.speechName);

  try {
    const created = await nextCustomerFromCall({
      fromNumber: session.fromNumber,
      first,
      last,
      spokenAddress: session.speechAddress,
    });
    session.customerRef = created.customerRef;
    session.contactRef = created.contactRef;
    session.isNewCustomer = true;
    await session.save();
  } catch (err) {
    console.error("Inbound IVR customer create failed:", err);
    return voicemailTwiml(
      account,
      "I'm sorry, I couldn't save your information.",
    );
  }

  try {
    if (session.customerRef && session.contactRef) {
      await attachCallToCustomer({
        account,
        callSid: session.callSid,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber,
        customerRef: session.customerRef,
        contactRef: session.contactRef,
      });
    }
  } catch (err) {
    console.error("Inbound IVR attach call failed:", err);
  }

  await setStep(session, "gather_days");
  return daysGatherTwiml(account, `Thanks ${first}.`);
}

async function handleGatherDays(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  spoken: string,
): Promise<string> {
  const days = parseSpokenDays(spoken);
  if (days.length === 0) {
    return retryOrVoicemail(
      session,
      account,
      daysGatherTwiml(
        account,
        "I didn't catch the days.",
      ),
    );
  }

  const spokenLabel = formatDaysSpoken(days);
  session.preferredDays = spokenLabel;
  await setStep(session, "confirm_days");
  return confirmDaysTwiml(account, spokenLabel);
}

async function handleConfirmDays(
  session: IVoiceIvrSession,
  account: ITwilioAccount,
  digits: string,
  spoken: string,
): Promise<string> {
  if (digits === "1") {
    const daysSpoken = session.preferredDays.trim();
    if (!daysSpoken) {
      await setStep(session, "gather_days");
      return daysGatherTwiml(account, "Let's try that again.");
    }
    return completeScheduleRequest(session, account, daysSpoken);
  }

  const corrected = parseSpokenDays(spoken);
  if (corrected.length > 0) {
    const spokenLabel = formatDaysSpoken(corrected);
    session.preferredDays = spokenLabel;
    await setStep(session, "confirm_days");
    return confirmDaysTwiml(account, spokenLabel);
  }

  if (!digits && !spoken) {
    return retryOrVoicemail(
      session,
      account,
      confirmDaysTwiml(
        account,
        session.preferredDays.trim() || "those days",
      ),
    );
  }

  await setStep(session, "gather_days");
  return daysGatherTwiml(account, "No problem.");
}

export async function handleIvrGather(opts: {
  account: ITwilioAccount;
  params: Record<string, string>;
}): Promise<string> {
  const callSid = opts.params.CallSid || opts.params.ParentCallSid || "";
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

  if (session.step === "menu") {
    return handleMenu(session, opts.account, digits);
  }

  const spoken = speech || (/^\d+$/.test(digits) ? "" : digits);

  if (session.step === "gather_name") {
    return handleGatherName(session, opts.account, spoken);
  }

  if (session.step === "gather_address") {
    return handleGatherAddress(session, opts.account, spoken);
  }

  if (session.step === "gather_days") {
    return handleGatherDays(session, opts.account, spoken);
  }

  if (session.step === "confirm_days") {
    return handleConfirmDays(session, opts.account, digits, speech);
  }

  return voicemailTwiml(opts.account);
}
