import Link from "next/link";
import { COMPANY } from "@/lib/constants";
import { SMS_MESSAGE_TYPES } from "@/lib/smsConsent";
import SmsConsentDisclosure from "@/components/legal/SmsConsentDisclosure";

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
          <h2 className="text-xl font-semibold text-brand-dark">What you may receive</h2>
          <p className="mt-3">
            Messages include {SMS_MESSAGE_TYPES}. Message frequency varies. Message
            and data rates may apply. Reply <strong>STOP</strong> to opt out or{" "}
            <strong>HELP</strong> for help. Consent is not a condition of purchase.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">How you opt in</h2>
          <p className="mt-3">
            You opt in by entering your mobile number and checking an{" "}
            <strong>unchecked</strong> box. We collect this consent on:
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
          <p className="mt-3">
            The disclosure next to the checkbox is the same on every form. A static
            example (not a live form) is shown below so reviewers can verify it
            without signing in.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            Example of our opt-in
          </h2>
          <p className="mt-3 text-sm text-neutral-500">
            Checkboxes start unchecked. This sample cannot be submitted.
          </p>
          <fieldset
            disabled
            className="mt-4 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4"
          >
            <legend className="sr-only">Sample SMS opt-in (disabled)</legend>
            <div>
              <label
                htmlFor="sms-program-sample-phone"
                className="block text-sm font-medium text-brand-dark"
              >
                Mobile number
              </label>
              <input
                id="sms-program-sample-phone"
                type="tel"
                readOnly
                tabIndex={-1}
                placeholder="(555)555-5555"
                className="mt-1 block w-full cursor-not-allowed rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-brand-dark"
              />
            </div>
            <label className="flex gap-3 text-sm text-brand-dark">
              <input
                type="checkbox"
                defaultChecked={false}
                tabIndex={-1}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-not-allowed rounded border-neutral-300 text-brand-orange"
              />
              <SmsConsentDisclosure />
            </label>
          </fieldset>
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
