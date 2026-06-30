import AuthCard from "@/components/auth/AuthCard";
import SignupForm from "@/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <AuthCard
      title="Create Your Account"
      subtitle="Get started with GRAC CRM today"
      footerText="Already have an account?"
      footerLinkText="Sign in"
      footerLinkHref="/auth/login"
    >
      <SignupForm />
    </AuthCard>
  );
}
