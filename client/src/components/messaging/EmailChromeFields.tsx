"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_EMAIL_CHROME,
  EMAIL_CHROME_HTML_MAX,
  EmailChrome,
} from "@/lib/emailChrome";
import EmailBodyEditor from "./EmailBodyEditor";

type EmailChromeFieldsProps = {
  value: EmailChrome;
  onChange: (next: EmailChrome) => void;
  showReset?: boolean;
  sections?: Array<"header" | "footer">;
};

type EditorTab = "visual" | "html";

function EmailHtmlSectionEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
}) {
  const [tab, setTab] = useState<EditorTab>("visual");

  return (
    <fieldset className="space-y-2 rounded-lg border border-neutral-200 p-3">
      <legend className="px-1 text-xs font-semibold text-brand-dark">
        {label}
      </legend>
      <div className="flex gap-1">
        {(["visual", "html"] as const).map((next) => (
          <button
            key={next}
            type="button"
            onClick={() => setTab(next)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${
              tab === next
                ? "bg-brand-dark text-white"
                : "border border-neutral-200 bg-white text-neutral-600 hover:border-brand-orange hover:text-brand-orange"
            }`}
          >
            {next === "html" ? "HTML" : "Visual"}
          </button>
        ))}
      </div>
      {tab === "visual" ? (
        <EmailBodyEditor
          value={value}
          onChange={onChange}
          placeholder={`Write the ${label.toLowerCase()}…`}
          maxLength={EMAIL_CHROME_HTML_MAX}
        />
      ) : (
        <div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            maxLength={EMAIL_CHROME_HTML_MAX}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs leading-5 text-brand-dark outline-none focus:border-brand-orange"
          />
          <p className="mt-1 text-right text-[11px] text-neutral-400">
            {value.length}/{EMAIL_CHROME_HTML_MAX}
          </p>
        </div>
      )}
    </fieldset>
  );
}

export default function EmailChromeFields({
  value,
  onChange,
  showReset = true,
  sections = ["header", "footer"],
}: EmailChromeFieldsProps) {
  const showHeader = sections.includes("header");
  const showFooter = sections.includes("footer");

  return (
    <div className="space-y-3">
      {showReset ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Header & footer
          </h3>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_EMAIL_CHROME)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50 hover:text-brand-dark"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to general
          </button>
        </div>
      ) : null}

      {showHeader ? (
        <EmailHtmlSectionEditor
          label="Header"
          value={value.headerHtml}
          onChange={(headerHtml) => onChange({ ...value, headerHtml })}
        />
      ) : null}

      {showFooter ? (
        <EmailHtmlSectionEditor
          label="Footer"
          value={value.footerHtml}
          onChange={(footerHtml) => onChange({ ...value, footerHtml })}
        />
      ) : null}

      {showReset ? (
        <p className="text-[11px] leading-4 text-neutral-400">
          HTML source is the saved layout. Switching to Visual may simplify
          advanced markup such as tables or images. The email preview on the
          right shows the assembled result.
        </p>
      ) : null}
    </div>
  );
}
