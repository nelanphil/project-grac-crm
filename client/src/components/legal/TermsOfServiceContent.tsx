import Link from "next/link";
import { COMPANY } from "@/lib/constants";

const LAST_UPDATED = "August 3, 2026";

export default function TermsOfServiceContent() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-brand-dark">Terms of Service</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-10 space-y-8 text-base leading-relaxed text-neutral-700">
        <section>
          <h2 className="text-xl font-semibold text-brand-dark">1. Acceptance of terms</h2>
          <p className="mt-3">
            These Terms of Service (“Terms”) govern your access to and use of the
            websites, customer portal, and related online services operated by{" "}
            {COMPANY.name} (“we,” “us,” or “our”). By creating an account, signing
            in, or otherwise using our services, you agree to these Terms and to our{" "}
            <Link
              href="/privacy"
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              Privacy Policy
            </Link>
            . If you do not agree, do not use our services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">2. Who we are</h2>
          <p className="mt-3">
            {COMPANY.name} provides generator installation, maintenance, repair, and
            related services in Central and South Florida. You can contact us at{" "}
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
          <h2 className="text-xl font-semibold text-brand-dark">3. Services</h2>
          <p className="mt-3">
            Our online services may include estimate requests, account access,
            invoices, service history, messaging, and other tools we make available
            from time to time. Service work at a property (installation, repair,
            maintenance, and similar) is governed by the applicable contract, work
            order, or written agreement for that job, in addition to these Terms.
          </p>
          <p className="mt-3">
            We may update, suspend, or discontinue features of the online services
            with or without notice, including for maintenance, security, or legal
            reasons.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">4. Accounts</h2>
          <p className="mt-3">
            You are responsible for maintaining the confidentiality of your login
            credentials and for activity that occurs under your account. Provide
            accurate information and keep your contact details up to date. Notify us
            promptly if you suspect unauthorized access.
          </p>
          <p className="mt-3">
            We may suspend or terminate access if we reasonably believe these Terms
            have been violated, your account is compromised, or continued access
            would create risk to you, us, or others.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">5. Acceptable use</h2>
          <p className="mt-3">You agree not to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Use the services for unlawful, harmful, or fraudulent purposes</li>
            <li>
              Attempt to gain unauthorized access to systems, data, or other users’
              accounts
            </li>
            <li>
              Interfere with or disrupt the services, including by introducing malware
              or automated scraping without permission
            </li>
            <li>
              Misrepresent your identity or relationship with {COMPANY.name}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            6. Communications and text messages
          </h2>
          <p className="mt-3">
            If you opt in to receive automated text message alerts, you consent to
            receive SMS/MMS messages from us at the phone number associated with your
            account or request about appointments, service updates, and related
            communications. Message and data rates may apply. Message frequency
            varies. Reply <strong>STOP</strong> to opt out; reply{" "}
            <strong>HELP</strong> for help. Consent is not a condition of purchase.
            Additional details are in our{" "}
            <Link
              href="/privacy"
              className="text-brand-orange underline-offset-2 hover:underline"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">7. Intellectual property</h2>
          <p className="mt-3">
            The services, including software, branding, and content we provide, are
            owned by us or our licensors and are protected by applicable intellectual
            property laws. You may use them only as needed to access the services
            under these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            8. Disclaimers
          </h2>
          <p className="mt-3">
            The online services are provided “as is” and “as available.” To the
            fullest extent permitted by law, we disclaim warranties of
            merchantability, fitness for a particular purpose, and non-infringement.
            We do not warrant that the services will be uninterrupted, error-free, or
            free of harmful components.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            9. Limitation of liability
          </h2>
          <p className="mt-3">
            To the fullest extent permitted by law, {COMPANY.name} and its officers,
            employees, and agents will not be liable for any indirect, incidental,
            special, consequential, or punitive damages, or for loss of profits,
            data, or goodwill, arising from your use of the online services. Our
            aggregate liability for claims relating to the online services will not
            exceed the greater of (a) the amounts you paid us for online portal
            access in the twelve months before the claim (if any) or (b) one hundred
            U.S. dollars. These limits do not apply to liability that cannot be
            limited under applicable law. Separate limitations may apply under a
            service contract for on-site work.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">10. Indemnity</h2>
          <p className="mt-3">
            You agree to indemnify and hold harmless {COMPANY.name} from claims,
            damages, and expenses (including reasonable attorneys’ fees) arising from
            your misuse of the services or violation of these Terms, except to the
            extent caused by our gross negligence or willful misconduct.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            11. Changes to these Terms
          </h2>
          <p className="mt-3">
            We may update these Terms from time to time. The “Last updated” date at
            the top will change when we do. Material changes may be communicated
            through the site or account notice. Continued use after the effective date
            constitutes acceptance of the updated Terms, except where applicable law
            requires additional consent.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">
            12. Governing law
          </h2>
          <p className="mt-3">
            These Terms are governed by the laws of the State of Florida, without
            regard to conflict-of-law rules. Courts located in Florida will have
            exclusive jurisdiction over disputes arising from these Terms or the
            online services, except where prohibited by law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-brand-dark">13. Contact</h2>
          <p className="mt-3">
            Questions about these Terms can be sent to{" "}
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
