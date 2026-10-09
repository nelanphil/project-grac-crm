import type { Metadata } from "next";
import SmsProgramContent from "@/components/legal/SmsProgramContent";
import { COMPANY } from "@/lib/constants";

export const metadata: Metadata = {
  title: `SMS Program — ${COMPANY.name}`,
  description:
    "Opt in to optional transactional text messages from Generator Maintenance of Florida. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help.",
};

export default function SmsProgramPage() {
  return <SmsProgramContent />;
}
