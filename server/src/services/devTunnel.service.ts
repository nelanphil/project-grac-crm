import twilio from "twilio";
import { env } from "../config/env";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import { getAccountAuthToken } from "./twilio.service";
import { isPubliclyReachableApiHost } from "../utils/publicUrl";
import { ensureVoiceIntelligenceService, intelligenceWebhookUrl } from "./callTranscription.service";
import { NgrokTunnel, publicBaseForLocalPort } from "../utils/ngrokTunnel";

const NGROK_AGENT_API = "http://127.0.0.1:4040/api/tunnels";
const SYNC_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let syncing = false;
let lastError = "";

/** Public https origin from a local ngrok agent, or null when it is not running. */
export async function readCurrentNgrokBase(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(NGROK_AGENT_API, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { tunnels?: NgrokTunnel[] };
    const base = publicBaseForLocalPort(body.tunnels ?? [], env.port);
    return base && isPubliclyReachableApiHost(base) ? base : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * When ngrok restarts it gets a new public address. Point each browser-calling
 * TwiML app at the address that is forwarding right now.
 */
export async function syncDevBrowserCallingTunnel(): Promise<void> {
  if (process.env.NODE_ENV === "production" || syncing) return;
  syncing = true;
  try {
    const base = await readCurrentNgrokBase();
    if (!base) return;
    const accounts = await TwilioAccount.find({ voiceTwimlAppSid: { $gt: "" } });
    for (const account of accounts) {
      const urlChanged = account.voicePublicBaseUrl !== base;
      const needsTranscripts = !account.voiceIntelligenceServiceSid;
      if (!urlChanged && !needsTranscripts) continue;
      const client = twilio(account.accountSid, getAccountAuthToken(account));
      if (urlChanged) {
        const voiceUrl = `${base}/webhooks/twilio/voice/client?accountSid=${encodeURIComponent(account.accountSid)}`;
        await client.applications(account.voiceTwimlAppSid).update({
          voiceUrl,
          voiceMethod: "POST",
        });
        if (account.voiceIntelligenceServiceSid) {
          await client.intelligence.v2.services(account.voiceIntelligenceServiceSid).update({
            webhookUrl: intelligenceWebhookUrl(base, account.accountSid),
            webhookHttpMethod: "POST",
          });
        }
        account.voicePublicBaseUrl = base;
      }
      if (needsTranscripts) {
        try {
          await ensureVoiceIntelligenceService(account, base);
        } catch (err) {
          console.warn(
            "[browser-calling] could not prepare call transcription:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      await account.save();
      if (urlChanged) {
        console.log(
          `[browser-calling] ngrok address changed; updated ${account.friendlyName} to ${base}`,
        );
      }
    }
    lastError = "";
  } catch (err) {
    const message = err instanceof Error ? err.message : "tunnel sync failed";
    if (message !== lastError) {
      console.warn("[browser-calling] could not update the ngrok address:", message);
      lastError = message;
    }
  } finally {
    syncing = false;
  }
}

export function startDevTunnelSync(): void {
  if (timer || process.env.NODE_ENV === "production") return;
  void syncDevBrowserCallingTunnel();
  timer = setInterval(() => {
    void syncDevBrowserCallingTunnel();
  }, SYNC_INTERVAL_MS);
  console.log("[browser-calling] watching local ngrok for address changes");
}

export function stopDevTunnelSync(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
