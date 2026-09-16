import Link from "next/link";
import { COMPANY } from "@/lib/constants";
import {
  SMS_CONSENT_DISCLOSURE_TEXT,
  SMS_MESSAGE_TYPES,
} from "@/lib/smsConsent";
import SmsOptInForm from "@/components/legal/SmsOptInForm";

const linkClass = "text-brand-orange underline-offset-2 hover:underline";

export default function SmsProgramContent() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-brand-dark">SMS Program</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Text messaging from {COMPANY.name}
      </p>

      <div className="mt-10 space-y-8 text-base leading-relaxed text-neutral-700">
        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            Opt in to text messages
          </h2>
          <p className="mt-3">
            End users opt in by visiting this page, entering a mobile number, and
            checking an unchecked checkbox. Consent is optional and is not required
            to create an account or to purchase. The same unchecked checkbox is also
            used at{" "}
            <Link href="/auth/signup" className={linkClass}>
              account signup
            </Link>
            .
          </p>
          <p className="mt-3">
            {COMPANY.name} sends optional automated transactional text messages
            including {SMS_MESSAGE_TYPES}. Message frequency varies. Message and
            data rates may apply. Msg & data rates may apply. Reply{" "}
            <strong>STOP</strong> to opt out or <strong>HELP</strong> for help.
            Consent is not a condition of purchase.
          </p>
          <p className="mt-3">
            Exact checkbox wording: {SMS_CONSENT_DISCLOSURE_TEXT}
          </p>
          <SmsOptInForm />
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">Who sends these messages</h2>
          <p className="mt-3">
            {COMPANY.name} (“we,” “us,” or “our”) sends optional automated
            transactional text messages to customers who have opted in. You can
            reach us at{" "}
            <a href={`mailto:${COMPANY.email}`} className={linkClass}>
              {COMPANY.email}
            </a>{" "}
            or{" "}
            <a href={COMPANY.phoneHref} className={linkClass}>
              {COMPANY.phone}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">How you opt in</h2>
          <p className="mt-3">
            You opt in by entering your mobile number and checking an{" "}
            <strong>unchecked</strong> box on this page, then submitting the form.
            We also collect this consent on:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Account signup at{" "}
              <Link href="/auth/signup" className={linkClass}>
                /auth/signup
              </Link>
            </li>
            <li>First login to the customer portal (after a staff member creates your account)</li>
            <li>
              Our estimate request form at{" "}
              <Link href="/estimate" className={linkClass}>
                /estimate
              </Link>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            Mobile information is not shared for marketing
          </h2>
          <p className="mt-3">
            We do not share, sell, or provide your mobile phone number or messaging
            consent data to third parties or affiliates for marketing or promotional
            purposes. Information sharing with service providers that send messages
            on our behalf (for example Twilio) is permitted solely to deliver those
            messages. Text messaging originator opt-in data and consent will not be
            shared with any third parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">Legal</h2>
          <p className="mt-3">
            See our{" "}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className={linkClass}>
              Terms of Service
            </Link>{" "}
            for full details.
          </p>
        </section>
      </div>
    </article>
  );
}
