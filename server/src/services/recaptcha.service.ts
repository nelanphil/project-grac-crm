import {
  RecaptchaCredentials,
  RecaptchaVersion,
} from "../models/mongo/RecaptchaCredentials";
import { decryptCredential } from "../utils/credentialsCrypto";

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

export interface RecaptchaVerifyInput {
  token: string;
  remoteIp?: string;
  expectedAction?: string;
}

export async function getActiveRecaptchaConfig(): Promise<{
  siteKey: string;
  secretKey: string;
  version: RecaptchaVersion;
  minScore: number;
} | null> {
  const doc = await RecaptchaCredentials.findOne({
    slug: "recaptcha",
    isActive: true,
  }).lean();
  if (!doc?.siteKey || !doc.secretKeyEncrypted) return null;

  try {
    return {
      siteKey: doc.siteKey,
      secretKey: decryptCredential(doc.secretKeyEncrypted),
      version: doc.version === "v3" ? "v3" : "v2",
      minScore: typeof doc.minScore === "number" ? doc.minScore : 0.5,
    };
  } catch (err) {
    console.error("[recaptcha] Failed to decrypt secret key:", err);
    return null;
  }
}

export async function verifyRecaptchaToken(
  input: RecaptchaVerifyInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const config = await getActiveRecaptchaConfig();
  if (!config) {
    return { ok: true };
  }

  const token = input.token.trim();
  if (!token) {
    return {
      ok: false,
      message: "Please complete the reCAPTCHA and try again.",
    };
  }

  const params = new URLSearchParams({
    secret: config.secretKey,
    response: token,
  });
  if (input.remoteIp) params.set("remoteip", input.remoteIp);

  let payload: {
    success?: boolean;
    score?: number;
    action?: string;
    "error-codes"?: string[];
  };
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    console.error("[recaptcha] siteverify request failed:", err);
    return {
      ok: false,
      message: "Unable to verify reCAPTCHA right now. Please try again.",
    };
  }

  if (!payload.success) {
    return {
      ok: false,
      message: "reCAPTCHA verification failed. Please try again.",
    };
  }

  if (config.version === "v3") {
    const score = typeof payload.score === "number" ? payload.score : 0;
    if (score < config.minScore) {
      return {
        ok: false,
        message: "reCAPTCHA verification failed. Please try again.",
      };
    }
    if (
      input.expectedAction &&
      payload.action &&
      payload.action !== input.expectedAction
    ) {
      return {
        ok: false,
        message: "reCAPTCHA verification failed. Please try again.",
      };
    }
  }

  return { ok: true };
}
