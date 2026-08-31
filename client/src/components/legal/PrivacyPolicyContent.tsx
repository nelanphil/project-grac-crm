import Link from "next/link";
import { COMPANY } from "@/lib/constants";

const LAST_UPDATED = "August 31, 2026";

export default function PrivacyPolicyContent() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-brand-dark">Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-10 space-y-8 text-base leading-relaxed text-neutral-700">
        <section>
          <h2 className="text-xl font-semibold text-brand-dark">1. Who we are</h2>
          <p className="mt-3">
            {COMPANY.name} (“we,” “us,” or “our”) provides generator installation,
            maintenance, and related services in Central and South Florida. You can
            contact us at{" "}
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.email}
            </a>{" "}
            or{" "}
            <a
              href={COMPANY.phoneHref}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.phone}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            2. Information we collect
          </h2>
          <p className="mt-3">Depending on how you use our website and services, we may collect:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Contact and estimate information</strong> — name, email address,
              phone number, property address, and details you provide when requesting
              an estimate or contacting us.
            </li>
            <li>
              <strong>Account information</strong> — if you have a staff or customer
              account, credentials and profile details associated with that account.
            </li>
            <li>
              <strong>Communications data</strong> — records of emails, calls, and
              text messages related to your requests or service.
            </li>
            <li>
              <strong>Technical and cookie data</strong> — information collected via
              cookies and similar technologies needed to operate the site (see Cookies
              below).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            3. How we use your information
          </h2>
          <p className="mt-3">We use personal information to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Respond to estimate requests and provide quotes and service</li>
            <li>Schedule appointments, perform work, and follow up on jobs</li>
            <li>
              Contact you by phone, email, or automated message when you have
              consented or as otherwise permitted by law
            </li>
            <li>Operate, secure, and improve our website and business systems</li>
            <li>Comply with legal obligations and enforce our agreements</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            4. Phone numbers, SMS, and voice communications
          </h2>
          <p className="mt-3">
            {COMPANY.name} offers an optional SMS program for transactional account
            and service notifications. If you provide a mobile number and opt in
            (for example, by checking an unchecked box on our signup form, first-login
            consent screen, or estimate request), you consent to receive automated
            SMS/MMS messages from {COMPANY.name} at that number. Messages may include
            appointment confirmations and reminders, invoices, payment receipts, and
            account or service alerts. Message frequency varies. Message and data
            rates may apply. Reply <strong>STOP</strong> to opt out; reply{" "}
            <strong>HELP</strong> for help. For help you may also contact us at{" "}
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.email}
            </a>{" "}
            or{" "}
            <a
              href={COMPANY.phoneHref}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.phone}
            </a>
            . Consent is not a condition of purchase. Program details are also on
            our{" "}
            <Link
              href="/sms-program"
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              SMS program
            </Link>{" "}
            page.
          </p>
          <p className="mt-3">
            We do not share, sell, or provide your mobile phone number or messaging
            consent data to third parties or affiliates for marketing or promotional
            purposes. Information sharing with service providers that send messages
            on our behalf (for example Twilio) is permitted solely to deliver those
            messages. Text messaging originator opt-in data and consent will not be
            shared with any third parties.
          </p>
          <p className="mt-3">
            By submitting an estimate request, you may also consent to receive phone
            calls and emails from us regarding your request, as described on the form
            at the time of submission. SMS is optional and is collected only through
            a separate, unchecked checkbox.
          </p>
          <p className="mt-3">
            Consent to marketing or promotional messages is separate from consent
            needed to provide a quote or service where applicable. You may withdraw
            SMS consent at any time by replying STOP or contacting us using the
            details above. Opting out of texts does not necessarily opt you out of
            transactional calls or emails related to an active service relationship.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            5. Third-party service providers (including Twilio)
          </h2>
          <p className="mt-3">
            We use trusted third-party processors to help us operate our business.
            In particular, we may use <strong>Twilio</strong> (and similar
            communications platforms) to send and receive SMS/MMS messages and to
            place or receive voice calls when you have provided a phone number and
            appropriate consent. Those providers process phone numbers and message
            content solely to deliver communications on our behalf, under their own
            privacy and security practices.
          </p>
          <p className="mt-3">
            We may also use other vendors for hosting, email delivery, payments, and
            analytics. We require processors to use personal information only as
            needed to provide their services to us.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">6. Cookies</h2>
          <p className="mt-3">
            We use cookies and similar technologies that are essential to run the
            site (for example, keeping you signed in and remembering preferences
            such as your cookie choices). Where we use optional cookies for
            analytics or similar purposes, we ask for your consent via our cookie
            banner. You can change your browser settings to block cookies, but some
            features of the site may not work correctly.
          </p>
          <p className="mt-3">
            Essential cookies continue to be used even if you decline optional
            cookies, so that the site remains functional and we can remember that you
            have already made a choice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            7. Sharing of information
          </h2>
          <p className="mt-3">
            We do not sell your personal information. We may share information with
            service providers who process data on our behalf (including Twilio,
            solely to deliver messages and calls you have consented to), when
            required by law, or in connection with a business transfer such as a
            merger or sale of assets.
          </p>
          <p className="mt-3">
            No mobile information will be shared with third parties or affiliates
            for marketing or promotional purposes. Information sharing to
            subcontractors in support services, such as customer service, is
            permitted. All other categories exclude text messaging originator opt-in
            data and consent; this information will not be shared with any third
            parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">8. Retention</h2>
          <p className="mt-3">
            We retain personal information for as long as needed to provide services,
            maintain business and legal records, resolve disputes, and comply with
            applicable law. Retention periods may vary depending on the type of data
            and our relationship with you.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            9. Your rights and choices
          </h2>
          <p className="mt-3">
            Depending on where you live, you may have rights to access, correct,
            delete, or obtain a copy of certain personal information, or to opt out of
            certain processing. To exercise these rights, or to update your
            communication preferences, contact us at{" "}
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.email}
            </a>
            . We will respond in accordance with applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            10. Children&apos;s privacy
          </h2>
          <p className="mt-3">
            Our services are directed to adults and businesses. We do not knowingly
            collect personal information from children under 13. If you believe we
            have collected such information, please contact us so we can delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            11. Changes to this policy
          </h2>
          <p className="mt-3">
            We may update this Privacy Policy from time to time. The “Last updated”
            date at the top of this page will reflect material changes. Continued use
            of our site or services after an update constitutes acceptance of the
            revised policy where permitted by law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">12. Contact us</h2>
          <p className="mt-3">
            Questions about this Privacy Policy or our data practices can be sent to{" "}
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.email}
            </a>{" "}
            or by calling{" "}
            <a
              href={COMPANY.phoneHref}
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              {COMPANY.phone}
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
