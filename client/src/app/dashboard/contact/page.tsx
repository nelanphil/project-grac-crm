import AuthGuard from "@/components/auth/AuthGuard";
import { Phone } from "lucide-react";

export default function ContactPage() {
  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Contact</h1>
          <p className="mt-1 text-sm text-neutral-500">View and manage customer contact records.</p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
          <Phone className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-500">No contacts yet</p>
          <p className="mt-1 text-xs text-neutral-400">Customer contact records will appear here.</p>
        </div>
      </div>
    </AuthGuard>
  );
}
