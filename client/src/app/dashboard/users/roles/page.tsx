"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import RolesTab from "./RolesTab";

export default function RolesPage() {
  return (
    <AuthGuard>
      <RolesTab />
    </AuthGuard>
  );
}
