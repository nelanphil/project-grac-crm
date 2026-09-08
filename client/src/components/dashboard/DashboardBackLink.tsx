"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  dashboardPathFromLocation,
  labelForDashboardPath,
  recordDashboardPath,
  resolveDashboardBackTarget,
  subscribeDashboardBack,
} from "@/lib/dashboard-back";

export const dashboardBackLinkClass =
  "inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors";

export const dashboardBackLinkMutedClass =
  "inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-brand-dark";

type DashboardBackLinkProps = {
  fallbackHref: string;
  fallbackLabel?: string;
  returnTo?: string | null;
  className?: string;
};

function snapshotOf(target: { href: string; label: string }): string {
  return JSON.stringify(target);
}

function parseSnapshot(snapshot: string): { href: string; label: string } {
  try {
    return JSON.parse(snapshot) as { href: string; label: string };
  } catch {
    return { href: "/dashboard", label: "Back" };
  }
}

function DashboardBackLinkInner({
  fallbackHref,
  fallbackLabel,
  returnTo,
  className = dashboardBackLinkClass,
}: DashboardBackLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = dashboardPathFromLocation(pathname, searchParams.toString());
  const queryReturnTo = returnTo ?? searchParams.get("returnTo");
  const fallback = {
    href: fallbackHref,
    label: fallbackLabel ?? labelForDashboardPath(fallbackHref),
  };

  const snapshot = useSyncExternalStore(
    subscribeDashboardBack,
    () =>
      snapshotOf(
        resolveDashboardBackTarget({
          currentPath,
          fallbackHref,
          fallbackLabel,
          returnTo: queryReturnTo,
        }),
      ),
    () => snapshotOf(fallback),
  );

  const { href, label } = parseSnapshot(snapshot);

  return (
    <Link href={href} className={className}>
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}

export default function DashboardBackLink(props: DashboardBackLinkProps) {
  return (
    <Suspense
      fallback={
        <Link href={props.fallbackHref} className={props.className ?? dashboardBackLinkClass}>
          <ArrowLeft className="h-4 w-4" />
          {props.fallbackLabel ?? "Back"}
        </Link>
      }
    >
      <DashboardBackLinkInner {...props} />
    </Suspense>
  );
}

export function DashboardHistoryTracker() {
  return (
    <Suspense fallback={null}>
      <DashboardHistoryTrackerInner />
    </Suspense>
  );
}

function DashboardHistoryTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    recordDashboardPath(dashboardPathFromLocation(pathname, searchParams.toString()));
  }, [pathname, searchParams]);

  return null;
}
