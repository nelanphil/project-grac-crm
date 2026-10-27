import { XaiCredentials, DEFAULT_GROK_MODEL } from "../models/mongo/XaiCredentials";
import { decryptCredential } from "../utils/credentialsCrypto";
import { GrokCallSummary, parseGrokCallSummary } from "../utils/grokCallSummary";
import { XaiListedModel, parseXaiModelList } from "../utils/xaiModels";

const XAI_URL = "https://api.x.ai/v1/chat/completions";

export async function loadXaiKey(): Promise<{ apiKey: string; model: string } | null> {
  const doc = await XaiCredentials.findOne({ isActive: true }).lean();
  if (!doc?.apiKeyEncrypted) return null;
  try {
    const apiKey = decryptCredential(String(doc.apiKeyEncrypted)).trim();
    if (!apiKey) return null;
    return { apiKey, model: String(doc.modelName || DEFAULT_GROK_MODEL).trim() || DEFAULT_GROK_MODEL };
  } catch {
    return null;
  }
}

async function complete(apiKey: string, model: string, messages: { role: string; content: string }[]): Promise<string> {
  const response = await fetch(XAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!response.ok) {
    throw new Error(body.error?.message || `xAI returned ${response.status}`);
  }
  return body.choices?.[0]?.message?.content?.trim() || "";
}

export async function listXaiLanguageModels(apiKey: string): Promise<XaiListedModel[]> {
  const response = await fetch("https://api.x.ai/v1/language-models", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string } | string;
  };
  if (!response.ok) {
    const detail = body.error;
    const message =
      typeof detail === "string"
        ? detail
        : detail?.message || `xAI returned ${response.status}`;
    throw new Error(message);
  }
  return parseXaiModelList(body);
}

export async function testXaiKey(apiKey: string, model: string): Promise<string> {
  const text = await complete(apiKey, model, [
    { role: "user", content: "Reply with the single word ok." },
  ]);
  if (!text) throw new Error("xAI returned an empty response");
  return text;
}

export async function summarizeCall(
  transcript: string,
  customerName: string,
): Promise<GrokCallSummary | null> {
  const creds = await loadXaiKey();
  if (!creds) return null;
  try {
    const content = await complete(creds.apiKey, creds.model, [
      {
        role: "system",
        content:
          "You summarize phone calls for a generator service company. Reply with JSON only: " +
          '{"summary":"2-4 sentences","task":{"needed":true,"title":"short task","description":"what to do","dueInDays":1}}. ' +
          "Set needed to false and leave title empty when the call does not require follow-up. dueInDays is an integer or null.",
      },
      {
        role: "user",
        content: `Customer: ${customerName || "Unknown"}\n\n${transcript.slice(0, 12000)}`,
      },
    ]);
    return parseGrokCallSummary(content);
  } catch (err) {
    console.warn("[grok] call summary failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
