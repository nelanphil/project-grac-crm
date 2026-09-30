"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import UsersTab from "./UsersTab";

export default function UsersPage() {
  return (
    <AuthGuard>
      <UsersTab />
    </AuthGuard>
  );
}
