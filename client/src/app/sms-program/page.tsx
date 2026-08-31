import type { Metadata } from "next";
import SmsProgramContent from "@/components/legal/SmsProgramContent";
import { COMPANY } from "@/lib/constants";

export const metadata: Metadata = {
  title: `SMS Program — ${COMPANY.name}`,
  description:
    "How Generator Maintenance of Florida sends optional transactional text messages, including opt-in, STOP/HELP, and privacy.",
};

export default function SmsProgramPage() {
  return <SmsProgramContent />;
}
