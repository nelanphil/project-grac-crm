import AuthGuard from "@/components/auth/AuthGuard";
import { ShoppingCart } from "lucide-react";

export default function OrdersPage() {
  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Orders</h1>
          <p className="mt-1 text-sm text-neutral-500">Manage and track customer orders.</p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
          <ShoppingCart className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-500">No orders yet</p>
          <p className="mt-1 text-xs text-neutral-400">Orders will appear here once they are created.</p>
        </div>
      </div>
    </AuthGuard>
  );
}
