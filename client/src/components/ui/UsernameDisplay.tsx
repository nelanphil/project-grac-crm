import type { ReactNode } from "react";

type UsernameDisplayProps = {
  username: string | null | undefined;
  usernameNumber?: number | null;
  className?: string;
  numberClassName?: string;
  empty?: ReactNode;
};

/** Display username with a subtle, smaller numeric suffix (e.g. doc¹ style as doc + 1). */
export default function UsernameDisplay({
  username,
  usernameNumber,
  className = "",
  numberClassName = "text-[0.7em] font-normal text-neutral-400 align-super ml-0.5",
  empty = "—",
}: UsernameDisplayProps) {
  if (!username) {
    return <span className={className}>{empty}</span>;
  }

  return (
    <span className={className}>
      {username}
      {usernameNumber != null && (
        <span className={numberClassName} aria-label={`number ${usernameNumber}`}>
          {usernameNumber}
        </span>
      )}
    </span>
  );
}
