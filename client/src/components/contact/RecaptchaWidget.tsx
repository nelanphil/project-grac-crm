"use client";

import { useEffect, useRef, useState } from "react";
import type { RecaptchaVersion } from "@/lib/api";

const SCRIPT_ID = "google-recaptcha-script";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render: (
        container: HTMLElement,
        options: { sitekey: string; theme?: string },
      ) => number;
      getResponse: (widgetId?: number) => string;
      reset: (widgetId?: number) => void;
      execute: (
        siteKey: string,
        options: { action: string },
      ) => Promise<string>;
    };
  }
}

function loadRecaptchaScript(src: string): Promise<void> {
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    if (window.grecaptcha) return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("reCAPTCHA failed to load")), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("reCAPTCHA failed to load"));
    document.head.appendChild(script);
  });
}

type RecaptchaWidgetProps = {
  siteKey: string;
  version: RecaptchaVersion;
};

export default function RecaptchaWidget({
  siteKey,
  version,
}: RecaptchaWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    widgetIdRef.current = null;

    const src =
      version === "v3"
        ? `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
        : "https://www.google.com/recaptcha/api.js?render=explicit";

    loadRecaptchaScript(src)
      .then(() => {
        if (cancelled || !window.grecaptcha) return;
        window.grecaptcha.ready(() => {
          if (cancelled || version !== "v2" || !containerRef.current) return;
          if (containerRef.current.childElementCount > 0) return;
          widgetIdRef.current = window.grecaptcha!.render(containerRef.current, {
            sitekey: siteKey,
          });
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "reCAPTCHA failed to load.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [siteKey, version]);

  return (
    <div>
      {version === "v2" && <div ref={containerRef} />}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export async function getRecaptchaToken(options: {
  siteKey: string;
  version: RecaptchaVersion;
}): Promise<string> {
  const grecaptcha = window.grecaptcha;
  if (!grecaptcha) {
    throw new Error("reCAPTCHA is still loading. Please wait a moment.");
  }

  if (options.version === "v3") {
    return new Promise((resolve, reject) => {
      grecaptcha.ready(() => {
        grecaptcha
          .execute(options.siteKey, { action: "contact" })
          .then(resolve)
          .catch(() =>
            reject(new Error("reCAPTCHA verification failed. Please try again.")),
          );
      });
    });
  }

  const token = grecaptcha.getResponse();
  if (!token) {
    throw new Error("Please complete the reCAPTCHA.");
  }
  return token;
}

export function resetRecaptchaWidget() {
  try {
    window.grecaptcha?.reset();
  } catch {
    // Widget may not be rendered yet.
  }
}
