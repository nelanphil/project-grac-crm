"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AllCustomersRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/customers");
  }, [router]);

  return null;
}
