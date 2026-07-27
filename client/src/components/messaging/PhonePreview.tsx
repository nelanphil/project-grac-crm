"use client";

type PhonePreviewProps = {
  message: string;
  contactLabel?: string;
  isSample?: boolean;
};

export default function PhonePreview({
  message,
  contactLabel,
  isSample,
}: PhonePreviewProps) {
  const display =
    message.trim() ||
    "Your message preview will appear here…";
  const empty = !message.trim();

  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative overflow-hidden rounded-[2rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-lg">
        {/* Dynamic island */}
        <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />

        <div className="flex h-[480px] flex-col bg-[#f2f2f7]">
          {/* Status / nav bar */}
          <div className="border-b border-neutral-200/80 bg-white/90 px-3 pb-2 pt-8 backdrop-blur">
            <p className="text-center text-[11px] font-semibold text-neutral-900">
              {contactLabel || "Preview"}
            </p>
            {isSample ? (
              <p className="text-center text-[10px] text-neutral-400">
                Sample contact data
              </p>
            ) : null}
          </div>

          {/* Chat area */}
          <div className="flex flex-1 flex-col justify-end gap-2 overflow-y-auto px-3 py-3">
            <div className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-neutral-200 px-3 py-2 text-[13px] leading-snug text-neutral-800">
              Hi — just checking in.
            </div>
            <div
              className={`max-w-[90%] self-end rounded-2xl rounded-br-md px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${
                empty
                  ? "bg-[#34c759]/70 text-white/80 italic"
                  : "bg-[#34c759] text-white"
              }`}
            >
              {display}
            </div>
          </div>

          {/* Composer chrome */}
          <div className="border-t border-neutral-200/80 bg-white/90 px-3 py-2 pb-4">
            <div className="flex items-center gap-2">
              <div className="h-8 flex-1 rounded-full border border-neutral-300 bg-white px-3 text-[11px] leading-8 text-neutral-400">
                Text Message
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#34c759] text-xs font-bold text-white">
                ↑
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
