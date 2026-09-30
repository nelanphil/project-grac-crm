"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import CustomerHomeDashboard from "@/components/dashboard/customer/CustomerHomeDashboard";
import StaffHomeDashboard from "@/components/dashboard/staff/StaffHomeDashboard";
import TechnicianHomeDashboard from "@/components/dashboard/staff/TechnicianHomeDashboard";
import { staffHomeView } from "@/lib/dashboard-home";
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

  if (isStaffRole(user)) {
    if (staffHomeView(user.jobRoleSlugs) === "technician") {
      return <TechnicianHomeDashboard />;
    }
    return <StaffHomeDashboard />;
  }

  return <CustomerHomeDashboard />;
}
