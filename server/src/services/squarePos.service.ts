import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";
import { PaymentEnvironment } from "../models/mongo/PaymentProviderAccount";
import { getSquareAppCredentials } from "./squareOAuth.service";

const STATE_TTL_MS = 30 * 60 * 1000;

export class PosChargeError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "PosChargeError";
    this.statusCode = statusCode;
  }
}

type PosChargeState = {
  invoiceId: string;
  amountCents: number;
  exp: number;
};

function signBody(body: string): string {
  return createHmac("sha256", env.jwt.secret).update(body).digest("base64url");
}

/** Signed token Square echoes back so the callback cannot be reused on another invoice. */
export function signPosChargeState(input: {
  invoiceId: string;
  amountCents: number;
  now?: number;
}): string {
  const payload: PosChargeState = {
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    exp: (input.now ?? Date.now()) + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBody(body)}`;
}

export function verifyPosChargeState(
  state: string,
  expected: { invoiceId: string; amountCents: number; now?: number },
): void {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) throw new PosChargeError("Invalid payment session");
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expectedSig = signBody(body);
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expectedSig);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new PosChargeError("Invalid payment session");
  }

  let parsed: PosChargeState;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new PosChargeError("Invalid payment session");
  }
  if (
    typeof parsed?.invoiceId !== "string" ||
    typeof parsed.amountCents !== "number" ||
    typeof parsed.exp !== "number"
  ) {
    throw new PosChargeError("Invalid payment session");
  }
  if (parsed.exp < (expected.now ?? Date.now())) {
    throw new PosChargeError("Payment session expired. Start Tap to Pay again.");
  }
  if (parsed.invoiceId !== expected.invoiceId) {
    throw new PosChargeError("Payment session does not match this invoice");
  }
  if (parsed.amountCents !== expected.amountCents) {
    throw new PosChargeError("Invoice amount changed. Start Tap to Pay again.");
  }
}

/** Application id for the Point of Sale deep link. The OAuth secret is not required. */
export async function squarePosApplicationId(
  environment: PaymentEnvironment,
): Promise<string> {
  const creds = await getSquareAppCredentials(environment);
  if (creds.applicationId.trim()) return creds.applicationId.trim();
  const fromEnv =
    environment === "sandbox"
      ? env.square.sandboxApplicationId
      : env.square.applicationId;
  return fromEnv.trim();
}
