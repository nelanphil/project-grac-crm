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

export default function TapToPayButton({
  token,
  invoiceId,
  disabled,
  className,
  onError,
}: Props) {
  const [platform, setPlatform] = useState<SquarePosPlatform>("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detectPlatform());
  }, []);

  if (platform === "unsupported") return null;
  const target = platform;

  async function start() {
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

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => void start()}
      className={className}
    >
      {busy ? "Opening Square…" : "Tap to Pay"}
    </button>
  );
}
