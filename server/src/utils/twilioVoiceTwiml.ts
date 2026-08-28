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
): string {
  const response = new twilio.twiml.VoiceResponse();
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
    numDigits: opts.speech ? undefined : (opts.numDigits ?? 1),
    timeout: opts.timeout ?? 6,
    input: opts.speech ? ["speech", "dtmf"] : ["dtmf"],
    speechTimeout: opts.speech ? "auto" : undefined,
    hints: opts.hints,
    actionOnEmptyResult: true,
  });
  gather.say(sayVoice(opts.voice), opts.prompt);
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
