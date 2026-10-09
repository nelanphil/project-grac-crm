"use client";

import { Component, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useHasHydrated } from "@/store/useHasHydrated";
import { useAuthStore } from "@/store/useAuthStore";
import {
  installCrashCapture,
  recordRoute,
  reloadApp,
  reportCrash,
  submitCrashReport,
  subscribeCrashes,
  type CrashSnapshot,
} from "@/lib/crashReport";

function CrashPathnameTracker() {
  const pathname = usePathname();
  useEffect(() => {
    recordRoute(pathname || "/");
  }, [pathname]);
  return null;
}

export function CrashModal({ crash }: { crash: CrashSnapshot }) {
  const hydrated = useHasHydrated();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [whatWereYouDoing, setWhatWereYouDoing] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const signedInEmail = user?.email || crash.userEmail;
  const showEmail = hydrated && !user && !crash.loggedIn;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const doing = whatWereYouDoing.trim();
    const happened = whatHappened.trim();
    if (!doing || !happened) {
      setError("Tell us what you were doing and what happened.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await submitCrashReport(
        crash,
        {
          whatWereYouDoing: doing,
          whatHappened: happened,
          reporterEmail: showEmail ? reporterEmail : undefined,
        },
        token,
      );
      reloadApp();
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof Error ? err.message : "Could not send the report.",
      );
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="crash-report-title"
        data-crash-dialog
        className="flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
            <div>
              <h2
                id="crash-report-title"
                className="text-lg font-bold text-brand-dark"
              >
                Something went wrong
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                The page hit an error. Tell us what you were doing, then send
                the report and reload the app.
              </p>
            </div>

            {signedInEmail ? (
              <p className="text-xs text-neutral-500">
                This report will be attached to {signedInEmail}.
              </p>
            ) : null}

            <label className="block text-sm font-medium text-brand-dark">
              What were you doing?
              <textarea
                required
                value={whatWereYouDoing}
                onChange={(event) => setWhatWereYouDoing(event.target.value)}
                maxLength={4000}
                rows={3}
                className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal text-brand-dark outline-none focus:border-brand-orange"
              />
            </label>

            <label className="block text-sm font-medium text-brand-dark">
              What happened?
              <textarea
                required
                value={whatHappened}
                onChange={(event) => setWhatHappened(event.target.value)}
                maxLength={4000}
                rows={3}
                className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal text-brand-dark outline-none focus:border-brand-orange"
              />
            </label>

            {showEmail ? (
              <label className="block text-sm font-medium text-brand-dark">
                Email
                <span className="ml-1 font-normal text-neutral-500">
                  (optional)
                </span>
                <input
                  type="email"
                  value={reporterEmail}
                  onChange={(event) => setReporterEmail(event.target.value)}
                  maxLength={320}
                  autoComplete="email"
                  className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal text-brand-dark outline-none focus:border-brand-orange"
                />
              </label>
            ) : null}

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={() => reloadApp()}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-4 py-2.5 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
            >
              Reload without sending
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange/90 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Submit and reload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type BoundaryState = {
  crash: CrashSnapshot | null;
  renderCrashed: boolean;
};

export default class CrashBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { crash: null, renderCrashed: false };
  private unsubscribe: (() => void) | null = null;

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { renderCrashed: true };
  }

  componentDidMount() {
    installCrashCapture();
    this.unsubscribe = subscribeCrashes((crash) => {
      this.setState((prev) => ({
        crash,
        renderCrashed: prev.renderCrashed || crash.source === "render",
      }));
    });
  }

  componentWillUnmount() {
    this.unsubscribe?.();
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportCrash({
      source: "render",
      name: error.name,
      message: error.message || "The application crashed.",
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    return (
      <>
        <CrashPathnameTracker />
        {this.state.renderCrashed ? null : this.props.children}
        {this.state.crash ? <CrashModal crash={this.state.crash} /> : null}
      </>
    );
  }
}
