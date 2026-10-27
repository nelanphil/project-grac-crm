import twilio from "twilio";
import { resolveSayVoice } from "./twilioVoices";

const TAKE_A_MESSAGE_PROMPT =
  "Please leave a message after the tone. Press pound when you are finished.";

type SayVoice = twilio.twiml.VoiceResponse["SayVoice"];
type SayOpts = { voice: SayVoice };

function sayVoice(voice?: string | null): SayOpts {
  return {
    voice: resolveSayVoice(voice) as SayVoice,
  };
}

export function buildTakeAMessageTwiml(
  recordingCallbackUrl: string,
  voice?: string | null,
  intro?: string,
): string {
  const response = new twilio.twiml.VoiceResponse();
  if (intro?.trim()) {
    response.say(sayVoice(voice), intro.trim());
  }
  response.say(sayVoice(voice), TAKE_A_MESSAGE_PROMPT);
  response.record({
    action: recordingCallbackUrl,
    method: "POST",
    transcribe: true,
    transcribeCallback: recordingCallbackUrl,
    playBeep: true,
    maxLength: 120,
    timeout: 5,
    finishOnKey: "#",
  });
  return response.toString();
}

export function buildSayHangupTwiml(text: string, voice?: string | null): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(sayVoice(voice), text);
  response.hangup();
  return response.toString();
}

export function buildGatherTwiml(opts: {
  prompt: string;
  actionUrl: string;
  voice?: string | null;
  numDigits?: number;
  speech?: boolean;
  timeout?: number;
  hints?: string;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    action: opts.actionUrl,
    method: "POST",
    numDigits: opts.numDigits ?? (opts.speech ? undefined : 1),
    timeout: opts.timeout ?? 6,
    input: opts.speech ? ["speech", "dtmf"] : ["dtmf"],
    speechTimeout: opts.speech ? "auto" : undefined,
    hints: opts.hints,
    actionOnEmptyResult: true,
  });
  gather.say(sayVoice(opts.voice), opts.prompt);
  return response.toString();
}

const MAX_RING_CLIENTS = 10;

export type RingAgentTarget = {
  identity: string;
  userId: string;
};

function twimlValue(value: string, fallback: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || fallback;
}

/** Ring up to 10 registered browsers at once. The first to answer is connected. */
export function buildRingAgentsTwiml(input: {
  agents: RingAgentTarget[];
  actionUrl: string;
  answeredUrlFor: (userId: string) => string;
  recordingStatusCallbackUrl: string;
  callerName: string;
  callerNumber: string;
  lineLabel: string;
  conversationId: string;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    timeout: 25,
    action: input.actionUrl,
    method: "POST",
    answerOnBridge: true,
    record: "record-from-answer-dual",
    recordingStatusCallback: input.recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed"],
  });
  const callerName = twimlValue(input.callerName, "Unknown");
  const callerNumber = twimlValue(input.callerNumber, "Unknown");
  const lineLabel = twimlValue(input.lineLabel, "Line");
  const conversationId = input.conversationId.trim().slice(0, 120);
  for (const agent of input.agents.slice(0, MAX_RING_CLIENTS)) {
    const identity = agent.identity.trim();
    const userId = agent.userId.trim();
    if (!identity || !userId) continue;
    const client = dial.client({
      statusCallback: input.answeredUrlFor(userId),
      statusCallbackEvent: ["answered"],
      statusCallbackMethod: "POST",
    });
    client.identity(identity);
    client.parameter({ name: "callerName", value: callerName });
    client.parameter({ name: "callerNumber", value: callerNumber });
    client.parameter({ name: "lineLabel", value: lineLabel });
    client.parameter({ name: "conversationId", value: conversationId });
  }
  return response.toString();
}

export function buildClientDialTwiml(input: {
  from: string;
  to: string;
  actionUrl: string;
  recordingStatusCallbackUrl: string;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    callerId: input.from,
    action: input.actionUrl,
    method: "POST",
    timeout: 30,
    record: "record-from-answer-dual",
    recordingStatusCallback: input.recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed"],
  });
  dial.number(input.to);
  return response.toString();
}

export function buildOutboundSayTwiml(
  text: string,
  voice?: string | null,
): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(sayVoice(voice), text);
  return response.toString();
}
