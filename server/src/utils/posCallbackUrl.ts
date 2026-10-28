import { env } from "../config/env";

/**
 * Static page Square Point of Sale returns to after Tap to Pay.
 * Square matches this URL exactly, so the invoice id rides in the signed
 * `state` value instead of a query parameter.
 */
export function buildPosCallbackUrl(): string {
  return `${env.clientUrl.replace(/\/$/, "")}/checkout/pos-callback`;
}
