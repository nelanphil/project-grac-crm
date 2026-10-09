"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { SMS_CONSENT_DISCLOSURE_TEXT } from "@/lib/smsConsent";

const linkClass =
  "font-medium text-brand-orange underline-offset-2 hover:underline";

function stopLabelToggle(e: MouseEvent) {
  e.stopPropagation();
}

interface SmsConsentDisclosureProps {
  className?: string;
}

export default function SmsConsentDisclosure({
  className,
}: SmsConsentDisclosureProps) {
  return (
    <span className={className}>
      {SMS_CONSENT_DISCLOSURE_TEXT} See our{" "}
      <Link
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        onClick={stopLabelToggle}
      >
        Privacy Policy
      </Link>{" "}
      and{" "}
      <Link
        href="/terms"
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        onClick={stopLabelToggle}
      >
        Terms of Service
      </Link>
      .
    </span>
  );
}
