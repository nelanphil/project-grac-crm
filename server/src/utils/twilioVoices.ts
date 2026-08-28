export const DEFAULT_SAY_VOICE = "Polly.Joanna";

export const TWILIO_SAY_VOICES = [
  { value: "Polly.Joanna", label: "Joanna (Amazon Polly)" },
  { value: "Polly.Matthew", label: "Matthew (Amazon Polly)" },
  { value: "Polly.Joey", label: "Joey (Amazon Polly)" },
  { value: "Polly.Salli", label: "Salli (Amazon Polly)" },
  { value: "Google.en-US-Neural2-F", label: "Neural female (Google)" },
  { value: "Google.en-US-Neural2-D", label: "Neural male (Google)" },
  { value: "alice", label: "Alice (legacy)" },
] as const;

export type TwilioSayVoice = (typeof TWILIO_SAY_VOICES)[number]["value"];

const VOICE_VALUES = new Set<string>(TWILIO_SAY_VOICES.map((v) => v.value));

export function resolveSayVoice(voice: string | null | undefined): string {
  const trimmed = (voice ?? "").trim();
  if (VOICE_VALUES.has(trimmed)) return trimmed;
  return DEFAULT_SAY_VOICE;
}

export const TWILIO_SAY_VOICE_VALUES = TWILIO_SAY_VOICES.map((v) => v.value) as [
  TwilioSayVoice,
  ...TwilioSayVoice[],
];
