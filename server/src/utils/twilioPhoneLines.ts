export interface TwilioPhoneLine {
  phoneNumber: string;
  label: string;
  twilioFriendlyName: string;
  incomingSid: string;
  sms: boolean;
  mms: boolean;
  voice: boolean;
}

export interface TwilioIncomingNumber {
  phoneNumber: string;
  friendlyName: string;
  sid: string;
  sms: boolean;
  mms: boolean;
  voice: boolean;
}

export interface TwilioPhoneLineLabelInput {
  phoneNumber: string;
  label?: string;
}

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function phoneLinesMatch(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return (
    da.length >= 7 &&
    db.length >= 7 &&
    (da.endsWith(db) || db.endsWith(da))
  );
}

export function normalizeStoredPhoneLine(raw: unknown): TwilioPhoneLine | null {
  if (typeof raw === "string") {
    const phoneNumber = raw.trim();
    if (!phoneNumber) return null;
    return {
      phoneNumber,
      label: "",
      twilioFriendlyName: "",
      incomingSid: "",
      sms: false,
      mms: false,
      voice: false,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const phoneNumber =
    typeof obj.phoneNumber === "string" ? obj.phoneNumber.trim() : "";
  if (!phoneNumber) return null;
  return {
    phoneNumber,
    label: typeof obj.label === "string" ? obj.label.trim() : "",
    twilioFriendlyName:
      typeof obj.twilioFriendlyName === "string"
        ? obj.twilioFriendlyName.trim()
        : "",
    incomingSid:
      typeof obj.incomingSid === "string" ? obj.incomingSid.trim() : "",
    sms: Boolean(obj.sms),
    mms: Boolean(obj.mms),
    voice: Boolean(obj.voice),
  };
}

export function normalizePhoneLines(raw: unknown): TwilioPhoneLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeStoredPhoneLine)
    .filter((line): line is TwilioPhoneLine => Boolean(line));
}

export function listedPhoneNumbers(raw: unknown): string[] {
  return normalizePhoneLines(raw).map((line) => line.phoneNumber);
}

export function labelForNumber(raw: unknown, phone: string): string | null {
  if (!phone.trim()) return null;
  const match = normalizePhoneLines(raw).find((line) =>
    phoneLinesMatch(line.phoneNumber, phone),
  );
  const label = match?.label.trim() ?? "";
  return label || null;
}

export function formatTwilioLine(
  label: string | null | undefined,
  phone: string,
): string {
  const trimmed = label?.trim() ?? "";
  if (trimmed && phone) return `${trimmed} · ${phone}`;
  return phone || trimmed;
}

function labelFromInputs(
  phoneNumber: string,
  existing: TwilioPhoneLine[],
  submitted?: TwilioPhoneLineLabelInput[],
): string {
  const fromSubmit = submitted?.find((line) =>
    phoneLinesMatch(line.phoneNumber, phoneNumber),
  );
  if (fromSubmit) return (fromSubmit.label ?? "").trim();
  const prev = existing.find((line) =>
    phoneLinesMatch(line.phoneNumber, phoneNumber),
  );
  return prev?.label ?? "";
}

/** Twilio's current numbers win. User labels are kept; new lines start unlabeled. */
export function mergePhoneLines(
  existingRaw: unknown,
  incoming: TwilioIncomingNumber[],
  submitted?: TwilioPhoneLineLabelInput[],
): TwilioPhoneLine[] {
  const existing = normalizePhoneLines(existingRaw);
  const merged: TwilioPhoneLine[] = [];
  for (const number of incoming) {
    const phoneNumber = number.phoneNumber.trim();
    if (!phoneNumber) continue;
    if (merged.some((line) => phoneLinesMatch(line.phoneNumber, phoneNumber))) {
      continue;
    }
    merged.push({
      phoneNumber,
      label: labelFromInputs(phoneNumber, existing, submitted),
      twilioFriendlyName: number.friendlyName.trim(),
      incomingSid: number.sid.trim(),
      sms: Boolean(number.sms),
      mms: Boolean(number.mms),
      voice: Boolean(number.voice),
    });
  }
  return merged;
}

/**
 * Overlay CRM labels onto stored lines. Unknown numbers are kept only when
 * nothing is stored yet (sync failed on create).
 */
export function applySubmittedLabels(
  existingRaw: unknown,
  submitted: TwilioPhoneLineLabelInput[],
): TwilioPhoneLine[] {
  const existing = normalizePhoneLines(existingRaw);
  if (existing.length === 0) {
    return submitted
      .map((line) => normalizeStoredPhoneLine({
        phoneNumber: line.phoneNumber,
        label: line.label ?? "",
      }))
      .filter((line): line is TwilioPhoneLine => Boolean(line));
  }
  return existing.map((line) => {
    const match = submitted.find((item) =>
      phoneLinesMatch(item.phoneNumber, line.phoneNumber),
    );
    if (!match) return line;
    return { ...line, label: (match.label ?? "").trim() };
  });
}
