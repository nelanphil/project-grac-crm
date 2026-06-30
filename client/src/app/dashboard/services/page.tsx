import AuthGuard from "@/components/auth/AuthGuard";
import { Wrench } from "lucide-react";

export default function ServicesPage() {
  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Services</h1>
          <p className="mt-1 text-sm text-neutral-500">View and manage scheduled service jobs.</p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
          <Wrench className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-500">No services scheduled</p>
          <p className="mt-1 text-xs text-neutral-400">Scheduled service jobs will appear here.</p>
        </div>
      </div>
    </AuthGuard>
  );
}
