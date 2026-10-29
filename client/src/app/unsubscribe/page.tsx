import { Suspense } from "react";
import AuthCard from "@/components/auth/AuthCard";
import UnsubscribeForm from "@/components/unsubscribe/UnsubscribeForm";

export default function UnsubscribePage() {
  return (
    <AuthCard
      title="Email preferences"
      subtitle="You can turn notifications off here. Turning them back on requires signing in."
      footerText="Have an account?"
      footerLinkText="Manage in Settings"
      footerLinkHref="/dashboard/settings"
    >
      <Suspense
        fallback={
          <div className="py-4 text-center text-sm text-neutral-500">
            Loading…
          </div>
        }
      >
        <UnsubscribeForm />
      </Suspense>
    </AuthCard>
  );
}
