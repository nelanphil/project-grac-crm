"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthCard from "@/components/auth/AuthCard";
import {
  ApiError,
  confirmPublicRenewalSchedule,
  getPublicRenewalSchedule,
  type PublicRenewalSchedule,
} from "@/lib/api";

const OFFICE_PHONE = "(386) 631-8982";

export default function ScheduleRenewalPage() {
  return (
    <AuthCard
      title="Schedule your service visit"
      subtitle="Your renewal is paid. Pick a recommended date, or call us if you need a different day."
    >
      <Suspense
        fallback={
          <p className="py-4 text-center text-sm text-neutral-500">Loading…</p>
        }
      >
        <ScheduleRenewalForm />
      </Suspense>
    </AuthCard>
  );
}

function ScheduleRenewalForm() {
  const params = useSearchParams();
  const token = (params.get("token") ?? "").trim();
  const requested = (params.get("date") ?? "").trim();
  const [offer, setOffer] = useState<PublicRenewalSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [confirmingDate, setConfirmingDate] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const displayError = token
    ? error
    : "This scheduling link is not valid.";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPublicRenewalSchedule(token)
      .then((next) => {
        if (!cancelled) setOffer(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "This scheduling link is not valid.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function confirm(date: string) {
    setConfirmingDate(date);
    setError(null);
    try {
      const result = await confirmPublicRenewalSchedule(token, date);
      setBooked(result.label);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We could not schedule this visit.",
      );
    } finally {
      setConfirmingDate(null);
    }
  }

  if (loading) {
    return <p className="py-4 text-center text-sm text-neutral-500">Loading…</p>;
  }

  if (booked) {
    return (
      <p className="text-sm text-neutral-700">
        You are scheduled for <strong>{booked}</strong>. We will assign a
        technician and confirm the time. Call {OFFICE_PHONE} if you need to
        change it.
      </p>
    );
  }

  if (displayError && !offer) {
    return (
      <div className="space-y-2 text-sm text-neutral-700">
        <p>{displayError}</p>
        <p>Call {OFFICE_PHONE} and we will schedule the visit with you.</p>
      </div>
    );
  }

  if (!offer || offer.status === "expired") {
    return (
      <div className="space-y-2 text-sm text-neutral-700">
        <p>This scheduling link has expired.</p>
        <p>Call {OFFICE_PHONE} and we will find a day that works.</p>
      </div>
    );
  }

  if (offer.status === "chosen") {
    return (
      <p className="text-sm text-neutral-700">
        {offer.firstName ? `${offer.firstName}, this` : "This"} visit is
        already set for <strong>{offer.label}</strong>. Call {OFFICE_PHONE} if
        you need a different day.
      </p>
    );
  }

  const highlighted =
    offer.dates.find((item) => item.date === requested) ?? offer.dates[0] ?? null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-700">
        {offer.firstName ? `Hi ${offer.firstName}. ` : ""}
        {highlighted
          ? "Confirm a recommended date and we will put that day on your service visit."
          : "Call us and we will schedule the visit with you."}
      </p>
      {offer.dates.length > 0 ? (
        <div className="space-y-2">
          {offer.dates.map((item) => (
            <button
              key={item.date}
              type="button"
              disabled={confirmingDate !== null}
              onClick={() => void confirm(item.date)}
              className={`block w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${
                item.date === highlighted?.date
                  ? "bg-brand-dark text-white hover:opacity-90"
                  : "border border-neutral-300 bg-white text-brand-dark hover:bg-neutral-50"
              }`}
            >
              {confirmingDate === item.date
                ? "Scheduling…"
                : `Confirm ${item.label}`}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <p className="text-sm text-neutral-500">
        Need a different day or immediate help? Call {OFFICE_PHONE}.
      </p>
    </div>
  );
}
