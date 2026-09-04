type EmailPreviewProps = {
  fromLabel?: string;
  toLabel?: string;
  subject: string;
  html: string;
  isSample?: boolean;
};

export default function EmailPreview({
  fromLabel,
  toLabel,
  subject,
  html,
  isSample,
}: EmailPreviewProps) {
  const displaySubject = subject.trim() || "Subject will appear here…";
  const emptySubject = !subject.trim();
  const emptyBody = !html.trim();

  return (
    <div className="mx-auto w-full max-w-[520px]">
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Inbox preview
          </p>
          {isSample ? (
            <p className="mt-0.5 text-[10px] text-neutral-400">
              Sample contact data
            </p>
          ) : null}
        </div>

        <dl className="space-y-1.5 border-b border-neutral-100 px-4 py-3 text-sm">
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-xs text-neutral-400">From</dt>
            <dd className="min-w-0 truncate text-xs text-brand-dark">
              {fromLabel || "Select a send-from account"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-xs text-neutral-400">To</dt>
            <dd className="min-w-0 truncate text-xs text-brand-dark">
              {toLabel || "jordan.lee@example.com"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-xs text-neutral-400">Subject</dt>
            <dd
              className={`min-w-0 truncate text-xs font-medium ${
                emptySubject ? "italic text-neutral-400" : "text-brand-dark"
              }`}
            >
              {displaySubject}
            </dd>
          </div>
        </dl>

        <div className="bg-neutral-100">
          {emptyBody ? (
            <p className="px-4 py-10 text-center text-xs italic text-neutral-400">
              Your email preview will appear here…
            </p>
          ) : (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={html}
              className="h-[420px] w-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
