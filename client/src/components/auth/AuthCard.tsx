import Link from "next/link";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footerText: string;
  footerLinkText: string;
  footerLinkHref: string;
}

export default function AuthCard({
  title,
  subtitle,
  children,
  footerText,
  footerLinkText,
  footerLinkHref,
}: AuthCardProps) {
  return (
    <div className="flex items-center justify-center bg-neutral-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-white p-8 shadow-lg">
          <div className="text-center">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-brand-dark"
            >
              GRAC<span className="text-brand-orange">CRM</span>
            </Link>
            <h1 className="mt-6 text-2xl font-bold text-brand-dark">
              {title}
            </h1>
            <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>
          </div>

          <div className="mt-8">{children}</div>

          <p className="mt-6 text-center text-sm text-neutral-600">
            {footerText}{" "}
            <Link
              href={footerLinkHref}
              className="font-semibold text-brand-orange hover:underline"
            >
              {footerLinkText}
            </Link>
          </p>
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
