export function wrapEmailHtml(html: string): string {
  if (!html || !html.trim()) return "";
  const baseStyles = `
    <style>
      :root { color-scheme: light; }
      html, body {
        margin: 0;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #1a202c;
        background-color: #ffffff;
      }
      img { max-width: 100%; height: auto; }
      a { color: #ea580c; }
      table { border-collapse: collapse; }
      pre { white-space: pre-wrap; font-family: inherit; }
    </style>
  `;

  if (/<html\b[^>]*>/i.test(html)) {
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${baseStyles}</head>`);
    }
    return html.replace(/<body\b[^>]*>/i, `$&${baseStyles}`);
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseStyles}
</head>
<body>
  ${html}
</body>
</html>`;
}

type EmailPreviewProps = {
  fromLabel?: string;
  toLabel?: string;
  subject?: string;
  html: string;
  isSample?: boolean;
  fullWidth?: boolean;
  frameClassName?: string;
  hideHeader?: boolean;
  headerTitle?: string;
};

export default function EmailPreview({
  fromLabel,
  toLabel,
  subject = "",
  html,
  isSample,
  fullWidth,
  frameClassName,
  hideHeader = false,
  headerTitle,
}: EmailPreviewProps) {
  const displaySubject = subject.trim() || "Subject will appear here…";
  const emptySubject = !subject.trim();
  const emptyBody = !html.trim();

  return (
    <div className={fullWidth ? "w-full" : "mx-auto w-full max-w-[580px]"}>
      <div className="theme-light overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {!hideHeader ? (
          <>
            <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {headerTitle ?? "Inbox preview"}
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
          </>
        ) : null}

        <div className="bg-neutral-100">
          {emptyBody ? (
            <p className="px-4 py-10 text-center text-xs italic text-neutral-400">
              Your email preview will appear here…
            </p>
          ) : (
            <iframe
              title={displaySubject}
              sandbox=""
              srcDoc={wrapEmailHtml(html)}
              className={frameClassName ?? "h-[620px] w-full border-0 bg-white"}
            />
          )}
        </div>
      </div>
    </div>
  );
}
