import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const RECORDING_PLAYBACK_PURPOSE = "voice_recording";
export const RECORDING_TOKEN_TTL_SECONDS = 60 * 60;

export type RecordingTokenPayload = {
  purpose: typeof RECORDING_PLAYBACK_PURPOSE;
  commId: string;
};

export function isTwilioApiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "api.twilio.com" || host.endsWith(".twilio.com");
  } catch {
    return /(?:^|[/.])(?:api\.)?twilio\.com(?:[:/]|$)/i.test(url);
  }
}

export function signRecordingPlaybackToken(communicationId: string): string {
  const payload: RecordingTokenPayload = {
    purpose: RECORDING_PLAYBACK_PURPOSE,
    commId: String(communicationId),
  };
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: RECORDING_TOKEN_TTL_SECONDS,
  });
}

export function verifyRecordingPlaybackToken(
  token: string,
  communicationId: string,
): boolean {
  try {
    const decoded = jwt.verify(token, env.jwt.secret) as RecordingTokenPayload;
    return (
      decoded?.purpose === RECORDING_PLAYBACK_PURPOSE &&
      decoded.commId === String(communicationId)
    );
  } catch {
    return false;
  }
}

export function recordingPlaybackPath(
  communicationId: string,
  token: string,
): string {
  return `/messaging/communications/${communicationId}/recording?token=${encodeURIComponent(token)}`;
}

export function signedRecordingPlaybackPath(communicationId: string): string {
  return recordingPlaybackPath(
    communicationId,
    signRecordingPlaybackToken(communicationId),
  );
}

export function storedTwilioRecordingUrl(
  mediaUrls: unknown,
): string | null {
  if (!Array.isArray(mediaUrls)) return null;
  for (const raw of mediaUrls) {
    const url = String(raw ?? "").trim();
    if (url && isTwilioApiUrl(url)) return url;
  }
  return null;
}

/**
 * Public mediaUrls. Voice: one path-only CRM URL
 * `/messaging/communications/{id}/recording?token=…` (no host).
 * Never emit api.twilio.com or media.twilio.com.
 */
export function publicMediaUrls(doc: {
  _id?: unknown;
  channel?: unknown;
  mediaUrls?: unknown;
}): string[] {
  const stored = Array.isArray(doc.mediaUrls)
    ? doc.mediaUrls.map((u) => String(u ?? "").trim()).filter(Boolean)
    : [];

  if (doc.channel === "voice") {
    if (stored.length === 0) return [];
    const id = String(doc._id ?? "");
    if (!id) return [];
    return [signedRecordingPlaybackPath(id)];
  }

  return stored.filter((url) => !isTwilioApiUrl(url));
}
