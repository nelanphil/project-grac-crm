import Link from "next/link";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footerText?: string;
  footerLinkText?: string;
  footerLinkHref?: string;
  /** Document-style layout so A2P crawlers do not treat the form as a popup. */
  variant?: "card" | "page";
}

export default function AuthCard({
  title,
  subtitle,
  children,
  footerText,
  footerLinkText,
  footerLinkHref,
  variant = "card",
}: AuthCardProps) {
  const showFooter = Boolean(footerText && footerLinkText && footerLinkHref);
  const isPage = variant === "page";

  return (
    <div
      className={
        isPage
          ? "bg-white px-4 py-8 sm:py-12"
          : "flex items-center justify-center bg-neutral-100 px-4 py-8 sm:py-12"
      }
    >
      <div className={`w-full min-w-0 ${isPage ? "mx-auto max-w-xl" : "max-w-md"}`}>
        <div
          className={
            isPage
              ? "bg-white py-2"
              : "rounded-lg bg-white p-5 shadow-lg sm:p-8"
          }
        >
          <div className="text-center">
            <Link
              href="/"
              className="text-lg font-bold tracking-tight text-brand-dark sm:text-xl"
            >
              <span className="sm:hidden">
                G<span className="text-brand-orange">MOF</span>
              </span>
              <span className="hidden sm:inline">
                Generator Maintenance{" "}
                <span className="text-brand-orange">of Florida</span>
              </span>
            </Link>
            <h1 className="mt-6 text-2xl font-bold text-brand-dark">{title}</h1>
            <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>
          </div>

          <div className="mt-8">{children}</div>

          {showFooter && (
            <p className="mt-6 text-center text-sm text-neutral-600">
              {footerText}{" "}
              <Link
                href={footerLinkHref!}
                className="font-semibold text-brand-orange hover:underline"
              >
                {footerLinkText}
              </Link>
            </p>
          )}
        </div>

        <p className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm text-neutral-600 hover:text-brand-orange"
          >
            &larr; Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
