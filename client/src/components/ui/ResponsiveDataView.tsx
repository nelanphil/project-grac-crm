import { ReactNode } from "react";

interface ResponsiveDataViewProps {
  /** Stacked card/list UI shown below the `md` breakpoint. */
  mobile: ReactNode;
  /** Table (or other dense layout) shown from `md` and up. */
  desktop: ReactNode;
  className?: string;
  /** Empty state shown for both breakpoints when provided. */
  empty?: ReactNode;
  isEmpty?: boolean;
}

/**
 * Renders a mobile card/list layout and a separate desktop table layout.
 * Use with {@link MobileDataCard} for list rows on small screens.
 */
export default function ResponsiveDataView({
  mobile,
  desktop,
  className = "",
  empty,
  isEmpty = false,
}: ResponsiveDataViewProps) {
  if (isEmpty && empty) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={className}>
      <div className="md:hidden space-y-3">{mobile}</div>
      <div className="hidden md:block">{desktop}</div>
    </div>
  );
}
