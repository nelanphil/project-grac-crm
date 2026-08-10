import { ReactNode } from "react";

/** Label/value row used inside mobile data cards. */
export function DataField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-neutral-700 break-words">{value}</dd>
    </div>
  );
}

interface MobileDataCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  fields?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}

/**
 * Stacked card row for dense data on small screens.
 * Prefer this over horizontal-scrolling tables below `md`.
 */
export default function MobileDataCard({
  title,
  subtitle,
  badges,
  fields,
  actions,
  onClick,
  className = "",
  children,
}: MobileDataCardProps) {
  const interactive = typeof onClick === "function";

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`w-full rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm ${
        interactive
          ? "cursor-pointer transition-colors hover:border-neutral-300 hover:bg-neutral-50/80 active:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/40"
          : ""
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-brand-dark">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 text-xs text-neutral-500">{subtitle}</div>
          ) : null}
          {badges ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>
          ) : null}
        </div>
        {actions ? (
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {fields ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">{fields}</dl>
      ) : null}
      {children}
    </div>
  );
}
