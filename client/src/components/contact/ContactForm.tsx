"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  getRecaptchaSiteKey,
  submitContactForm,
  type RecaptchaVersion,
} from "@/lib/api";
import { COMPANY } from "@/lib/constants";
import RecaptchaWidget, {
  getRecaptchaToken,
  resetRecaptchaWidget,
} from "@/components/contact/RecaptchaWidget";

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 px-4 py-3 text-brand-dark placeholder:text-neutral-400 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  website: string;
};

type FieldKey = Exclude<keyof FormState, "website">;

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  message: "",
  website: "",
};

function validate(form: FormState): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (!form.firstName.trim()) errors.firstName = "First name is required";
  if (!form.lastName.trim()) errors.lastName = "Last name is required";
  if (!form.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Please enter a valid email";
  }
  if (!form.message.trim()) errors.message = "Message is required";
  return errors;
}

export default function ContactForm() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [recaptcha, setRecaptcha] = useState<{
    siteKey: string;
    version: RecaptchaVersion;
  } | null>(null);

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field !== "website") {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    getRecaptchaSiteKey()
      .then((result) => {
        if (cancelled || !result.siteKey) return;
        setRecaptcha({ siteKey: result.siteKey, version: result.version });
      })
      .catch(() => {
        // Form still works if the public site-key endpoint is down; server
        // will reject the submit if reCAPTCHA is required.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError("");

    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      let recaptchaToken: string | undefined;
      if (recaptcha) {
        recaptchaToken = await getRecaptchaToken({
          siteKey: recaptcha.siteKey,
          version: recaptcha.version,
        });
      }

      await submitContactForm({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        message: form.message.trim(),
        website: form.website,
        recaptchaToken,
      });
      setSubmitted(true);
    } catch (err) {
      resetRecaptchaWidget();
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-neutral-100 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange">
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-bold text-brand-dark">
            Message sent
          </h1>
          <p className="mt-4 text-lg text-neutral-600">
            Thanks for reaching out. A member of the {COMPANY.name} team will
            get back to you shortly.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/" className="btn-primary">
              Back to Home
            </Link>
            <a href={COMPANY.phoneHref} className="btn-outline-dark">
              Call {COMPANY.phone}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-100 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl">
        <nav className="mb-8 text-sm text-neutral-600">
          <Link href="/" className="hover:text-brand-orange">
            Home
          </Link>
          <span className="mx-2">&gt;</span>
          <span className="text-brand-dark">Contact</span>
        </nav>

        <h1 className="text-3xl font-bold text-brand-dark sm:text-4xl">
          Contact us
        </h1>
        <p className="mt-2 text-neutral-600">
          Send a message and we&apos;ll get back to you. For urgent service,
          call{" "}
          <a
            href={COMPANY.phoneHref}
            className="font-medium text-brand-orange hover:underline"
          >
            {COMPANY.phone}
          </a>
          .
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 space-y-5 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8"
          noValidate
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="firstName"
                className="block text-sm font-medium text-brand-dark"
              >
                First name
              </label>
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                value={form.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                className={inputClass}
              />
              {errors.firstName && (
                <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>
              )}
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="block text-sm font-medium text-brand-dark"
              >
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                value={form.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                className={inputClass}
              />
              {errors.lastName && (
                <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-brand-dark"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              className={inputClass}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-brand-dark"
            >
              Phone{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="message"
              className="block text-sm font-medium text-brand-dark"
            >
              Message
            </label>
            <textarea
              id="message"
              rows={6}
              value={form.message}
              onChange={(e) => updateField("message", e.target.value)}
              className={inputClass}
            />
            {errors.message && (
              <p className="mt-1 text-sm text-red-600">{errors.message}</p>
            )}
          </div>

          <div className="sr-only" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(e) => updateField("website", e.target.value)}
            />
          </div>

          {recaptcha && (
            <div>
              <RecaptchaWidget
                siteKey={recaptcha.siteKey}
                version={recaptcha.version}
              />
              {recaptcha.version === "v3" && (
                <p className="mt-2 text-xs text-neutral-500">
                  This site is protected by reCAPTCHA and the Google{" "}
                  <a
                    href="https://policies.google.com/privacy"
                    className="underline hover:text-brand-dark"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Privacy Policy
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://policies.google.com/terms"
                    className="underline hover:text-brand-dark"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Terms of Service
                  </a>{" "}
                  apply.
                </p>
              )}
            </div>
          )}

          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full disabled:opacity-60 sm:w-auto"
          >
            {isSubmitting ? "Sending…" : "Send message"}
          </button>
        </form>
      </div>
    </div>
  );
}
