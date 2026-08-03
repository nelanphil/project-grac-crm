import AuthCard from "@/components/auth/AuthCard";
import LegalConsentForm from "@/components/auth/LegalConsentForm";
import LegalConsentGuard from "@/components/auth/LegalConsentGuard";

export default function LegalConsentPage() {
  return (
    <LegalConsentGuard>
      <AuthCard
        title="Legal Terms"
        subtitle="Please accept our terms to continue"
      >
        <LegalConsentForm />
      </AuthCard>
    </LegalConsentGuard>
  );
}
