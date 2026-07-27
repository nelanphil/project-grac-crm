import AuthCard from "@/components/auth/AuthCard";
import LoginForm from "@/components/auth/LoginForm";
import GuestGuard from "@/components/auth/GuestGuard";

export default function LoginPage() {
  return (
    <GuestGuard>
      <AuthCard
        title="Welcome Back"
        subtitle="Sign in to your GRAC CRM account"
        footerText="Don't have an account?"
        footerLinkText="Sign up"
        footerLinkHref="/auth/signup"
      >
        <LoginForm />
      </AuthCard>
    </GuestGuard>
  );
}
