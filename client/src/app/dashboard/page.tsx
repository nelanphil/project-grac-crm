"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import CustomerHomeDashboard from "@/components/dashboard/customer/CustomerHomeDashboard";
import StaffHomeDashboard from "@/components/dashboard/staff/StaffHomeDashboard";
import { isStaffRole } from "@/lib/dashboard-role";
import { useAuthStore } from "@/store/useAuthStore";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const { user } = useAuthStore();

  if (!user) return null;

  if (isStaffRole(user.role)) {
    return <StaffHomeDashboard />;
  }

  return <CustomerHomeDashboard />;
}
