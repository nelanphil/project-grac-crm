import twilio from "twilio";

const TAKE_A_MESSAGE_PROMPT =
  "Please leave a message after the tone. Press pound when you are finished.";

/** TwiML for inbound Voice: short prompt, then record + transcribe. */
export function buildTakeAMessageTwiml(recordingCallbackUrl: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: "alice" }, TAKE_A_MESSAGE_PROMPT);
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
