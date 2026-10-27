import { VoiceAgentPresence } from "../models/mongo/VoiceAgentPresence";

/** A browser is online if it heartbeated inside this window. */
export const VOICE_PRESENCE_MS = 3 * 60 * 1000;

export const MAX_RING_AGENTS = 10;

export type OnlineVoiceAgent = {
  userId: string;
  identity: string;
};

export async function listOnlineVoiceAgents(
  accountSid: string,
): Promise<OnlineVoiceAgent[]> {
  if (!accountSid) return [];
  const cutoff = new Date(Date.now() - VOICE_PRESENCE_MS);
  const rows = await VoiceAgentPresence.find({
    accountSid,
    lastSeenAt: { $gte: cutoff },
  })
    .sort({ lastSeenAt: -1 })
    .limit(MAX_RING_AGENTS)
    .select("userRef identity")
    .lean();

  const seen = new Set<string>();
  const agents: OnlineVoiceAgent[] = [];
  for (const row of rows) {
    const identity = (row.identity || "").trim();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    agents.push({ userId: String(row.userRef), identity });
  }
  return agents;
}
