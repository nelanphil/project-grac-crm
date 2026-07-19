import { Suspense } from "react";
import AuthCard from "@/components/auth/AuthCard";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Reset password"
      subtitle="Choose a new password for your account"
      footerText="Back to"
      footerLinkText="Sign in"
      footerLinkHref="/auth/login"
    >
      <Suspense
        fallback={
          <div className="text-sm text-neutral-500 py-4 text-center">
            Loading…
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
