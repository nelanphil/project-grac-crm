import type { AutosaveStatus as Status } from "@/lib/useWorkOrderAutosave";

export default function AutosaveStatus({
  status,
  error,
  blockedReason,
  onRetry,
  className = "",
}: {
  status: Status;
  error: string | null;
  blockedReason?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  if (status === "error") {
    return (
      <p role="alert" className={`text-sm text-red-700 ${className}`}>
        {error ?? "Couldn't save changes."}{" "}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="font-medium underline hover:no-underline"
          >
            Try again
          </button>
        ) : null}
      </p>
    );
  }
  if (blockedReason) {
    return (
      <p className={`text-sm text-amber-700 ${className}`}>
        Not saved yet: {blockedReason}
      </p>
    );
  }
  const label =
    status === "saving" || status === "pending"
      ? "Saving…"
      : status === "saved"
        ? "All changes saved"
        : "Changes save automatically";
  return (
    <p aria-live="polite" className={`text-sm text-neutral-500 ${className}`}>
      {label}
    </p>
  );
}
