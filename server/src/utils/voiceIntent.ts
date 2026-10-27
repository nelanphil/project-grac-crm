export const VOICE_INTENT_TTL_MS = 5 * 60 * 1000;

export function voiceIdentity(userId: string): string {
  return `user_${userId}`;
}

export type VoiceIntentDecision =
  | { ok: true; replay: boolean }
  | { ok: false; message: string };

/** Whether a stored call intent may dial. A retry of the same Twilio call is allowed. */
export function evaluateVoiceIntent(input: {
  userId: string;
  expiresAt: Date;
  twilioCallSid: string;
  identity: string;
  callSid: string;
  now: Date;
}): VoiceIntentDecision {
  if (!input.callSid) {
    return { ok: false, message: "Missing call id." };
  }
  if (input.identity !== voiceIdentity(input.userId)) {
    return { ok: false, message: "This call was started by someone else." };
  }
  if (input.twilioCallSid && input.twilioCallSid !== input.callSid) {
    return { ok: false, message: "This call request was already used." };
  }
  if (!input.twilioCallSid && input.expiresAt.getTime() <= input.now.getTime()) {
    return { ok: false, message: "This call request expired." };
  }
  return { ok: true, replay: Boolean(input.twilioCallSid) };
}
