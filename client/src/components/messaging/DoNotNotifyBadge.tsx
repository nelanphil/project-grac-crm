export default function DoNotNotifyBadge({ reason }: { reason?: string }) {
  return (
    <span
      title={reason || "This contact cannot be notified"}
      className="inline-flex rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700"
    >
      Do not notify
    </span>
  );
}
