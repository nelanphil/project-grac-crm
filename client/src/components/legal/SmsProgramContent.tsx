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

      <div className="mt-10 space-y-6 text-base leading-relaxed text-neutral-700">
        <h2 className="text-xl font-semibold text-brand-dark">
          Opt in to text messages
        </h2>
        <p>
          End users opt in at this page by entering their mobile number, checking
          an unchecked checkbox, and submitting the form. Consent is optional and
          is not required to create an account or to purchase.
        </p>
        <p>
          {COMPANY.name} sends optional automated transactional text messages
          including {SMS_MESSAGE_TYPES}. Message frequency varies. Message and
          data rates may apply. Msg and data rates may apply. Msg & data rates may
          apply. Reply <strong>STOP</strong> to opt out or <strong>HELP</strong>{" "}
          for help. Consent is not a condition of purchase.
        </p>
        <p>Exact checkbox wording: {SMS_CONSENT_DISCLOSURE_TEXT}</p>
        <p>
          {SMS_CONSENT_DISCLOSURE_TEXT} See our{" "}
          <a href="/privacy" className={linkClass}>
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="/terms" className={linkClass}>
            Terms of Service
          </a>
          .
        </p>

        <SmsOptInForm />

        <h2 className="text-xl font-semibold text-brand-dark">
          Who sends these messages
        </h2>
        <p>
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

        <h2 className="text-xl font-semibold text-brand-dark">
          Mobile information is not shared for marketing
        </h2>
        <p>
          We do not share, sell, or provide your mobile phone number or messaging
          consent data to third parties or affiliates for marketing or promotional
          purposes. Information sharing with service providers that send messages
          on our behalf (for example Twilio) is permitted solely to deliver those
          messages. Text messaging originator opt-in data and consent will not be
          shared with any third parties.
        </p>
      </div>
    </article>
  );
}
