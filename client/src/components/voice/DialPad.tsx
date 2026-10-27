"use client";

const KEYS: { key: string; letters: string }[] = [
  { key: "1", letters: "" },
  { key: "2", letters: "ABC" },
  { key: "3", letters: "DEF" },
  { key: "4", letters: "GHI" },
  { key: "5", letters: "JKL" },
  { key: "6", letters: "MNO" },
  { key: "7", letters: "PQRS" },
  { key: "8", letters: "TUV" },
  { key: "9", letters: "WXYZ" },
  { key: "*", letters: "" },
  { key: "0", letters: "+" },
  { key: "#", letters: "" },
];

export default function DialPad({
  onPress,
  onBackspace,
  tone = "light",
}: {
  onPress: (key: string) => void;
  onBackspace?: () => void;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const keyClass = dark
    ? "rounded-md bg-white/10 py-2 text-inherit hover:bg-white/20"
    : "rounded-md bg-[var(--staff-cream)] py-2 text-[var(--staff-ink)] hover:bg-[var(--staff-border)]";
  return (
    <div className="grid grid-cols-3 gap-1">
      {KEYS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onPress(item.key)}
          className={keyClass}
        >
          <span className="block text-sm font-medium leading-none">{item.key}</span>
          <span className={`mt-0.5 block h-3 text-[9px] tracking-wide ${dark ? "opacity-70" : "text-[var(--staff-muted)]"}`}>
            {item.letters}
          </span>
        </button>
      ))}
      {onBackspace ? (
        <button
          type="button"
          onClick={onBackspace}
          className={`${keyClass} col-span-3`}
        >
          <span className="text-xs font-medium">Delete</span>
        </button>
      ) : null}
    </div>
  );
}
