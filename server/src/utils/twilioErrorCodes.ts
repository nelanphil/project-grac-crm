/**
 * Human-readable descriptions for common Twilio error codes.
 *
 * Twilio's REST API and status-callback webhooks frequently return an
 * ErrorCode without any ErrorMessage text (e.g. message.errorCode === 30034
 * but message.errorMessage === null), leaving the UI with nothing useful to
 * show. This map fills in the gap so failures surface a real explanation
 * instead of a bare number.
 *
 * Reference: https://www.twilio.com/docs/api/errors
 */
const TWILIO_ERROR_DESCRIPTIONS: Record<string, string> = {
  "20003":
    "Authentication error — the Account SID and Auth Token do not match.",
  "21211": "Invalid 'To' phone number.",
  "21606":
    "The 'From' phone number is not a valid, message-capable Twilio number for this destination.",
  "21608": "The 'To' number is unverified (trial account restriction).",
  "21610":
    "The recipient has opted out (replied STOP) and cannot receive messages.",
  "21614":
    "The 'To' number is not a valid mobile number and cannot receive SMS/MMS.",
  "30001": "Message queue is full — the destination carrier is throttling.",
  "30002": "Account suspended.",
  "30003": "Unreachable destination handset (phone off or out of coverage).",
  "30004": "Message blocked by the carrier or recipient.",
  "30005":
    "Unknown destination handset — number may be unreachable or invalid.",
  "30006": "Landline or unreachable carrier — cannot receive SMS.",
  "30007": "Message filtered by carrier as spam/suspicious content.",
  "30008": "Unknown error from the carrier — delivery could not be confirmed.",
  "30032": "Toll-Free number verification required before sending is allowed.",
  "30034":
    "A2P 10DLC registration required — this number is not registered for US application-to-person messaging.",
  "30035": "A2P 10DLC campaign not registered for this message type.",
  "30044": "Message blocked by carrier content filtering.",
};

/**
 * Builds a human-readable description for a Twilio error, combining the
 * numeric code (if any) with a known description or the raw message Twilio
 * provided as a fallback.
 */
export function describeTwilioError(
  code?: string | number | null,
  rawMessage?: string | null,
): string | null {
  const codeStr = code != null ? String(code) : null;
  const known = codeStr ? TWILIO_ERROR_DESCRIPTIONS[codeStr] : undefined;

  if (codeStr && known) {
    return `Error ${codeStr}: ${known}`;
  }
  if (codeStr && rawMessage) {
    return `Error ${codeStr}: ${rawMessage}`;
  }
  if (codeStr) {
    return `Error ${codeStr}`;
  }
  return rawMessage || null;
}
