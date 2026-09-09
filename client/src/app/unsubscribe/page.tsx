import { Suspense } from "react";
import AuthCard from "@/components/auth/AuthCard";
import UnsubscribeForm from "@/components/unsubscribe/UnsubscribeForm";

export default function UnsubscribePage() {
  return (
    <AuthCard
      title="Email preferences"
      subtitle="Turn general notifications or billing alerts on or off. You do not need to be signed in."
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
