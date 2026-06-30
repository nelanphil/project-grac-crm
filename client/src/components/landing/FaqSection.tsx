import { FAQS, COMPANY } from "@/lib/constants";

export default function FaqSection() {
  return (
    <section id="faq" className="bg-neutral-100 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
            Backup Generator FAQs
          </p>
          <h2 className="section-heading mt-2">Frequently Asked Questions</h2>
        </div>

        <div className="mx-auto mt-16 max-w-3xl divide-y divide-neutral-200">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold text-brand-dark">
                {faq.question}
                <svg
                  className="h-5 w-5 shrink-0 text-brand-orange transition-transform group-open:rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </summary>
              <p className="mt-4 text-neutral-600">{faq.answer}</p>
            </details>
          ))}
        </div>

        <div className="mx-auto mt-12 max-w-xl text-center">
          <h3 className="text-xl font-bold text-brand-dark">
            Still have questions?
          </h3>
          <p className="mt-3 text-neutral-600">
            Can&apos;t find the answer you&apos;re looking for? Call us and
            we&apos;ll get back to you as soon as possible.
          </p>
          <a href={COMPANY.phoneHref} className="btn-primary mt-6 inline-flex">
            Call {COMPANY.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
