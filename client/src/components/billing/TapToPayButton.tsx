"use client";

import { useEffect, useState } from "react";
import { ApiError, startInvoicePosCharge } from "@/lib/api";
import {
  buildSquarePosUrl,
  detectPlatform,
  type SquarePosPlatform,
} from "@/lib/squarePos";

type Props = {
  token: string;
  invoiceId: string;
  disabled?: boolean;
  className?: string;
  onError: (message: string | null) => void;
};

/** Opens Square Point of Sale for the invoice. `supported` is false off iOS and Android. */
export function useTapToPay({
  token,
  invoiceId,
  onError,
}: Pick<Props, "token" | "invoiceId" | "onError">) {
  const [platform, setPlatform] = useState<SquarePosPlatform>("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detectPlatform());
  }, []);

  async function start() {
    if (platform === "unsupported") return;
    const target = platform;
    setBusy(true);
    onError(null);
    try {
      const charge = await startInvoicePosCharge(token, invoiceId);
      window.location.href = buildSquarePosUrl(target, charge);
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to start Tap to Pay.",
      );
      setBusy(false);
    }
  }

  return { supported: platform !== "unsupported", busy, start };
}

export default function TapToPayButton({
  token,
  invoiceId,
  disabled,
  className,
  onError,
}: Props) {
  const tap = useTapToPay({ token, invoiceId, onError });
  if (!tap.supported) return null;

  return (
    <button
      type="button"
      disabled={disabled || tap.busy}
      onClick={() => void tap.start()}
      className={className}
    >
      {tap.busy ? "Opening Square…" : "Tap to Pay"}
    </button>
  );
}
