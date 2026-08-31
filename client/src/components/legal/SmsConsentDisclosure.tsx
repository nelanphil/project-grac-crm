"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { COMPANY } from "@/lib/constants";
import { SMS_MESSAGE_TYPES } from "@/lib/smsConsent";

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
      I agree to receive automated transactional text messages from {COMPANY.name}{" "}
      at the mobile number I provide, including {SMS_MESSAGE_TYPES}. Message
      frequency varies. Message and data rates may apply. Reply STOP to opt out or
      HELP for help. Consent is not a condition of purchase. See our{" "}
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
