import type { Metadata } from "next";
import SmsProgramContent from "@/components/legal/SmsProgramContent";
import { pageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = pageMetadata({
  title: "SMS Program",
  description:
    "Opt in to optional transactional text messages from Generator Maintenance of Florida. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help.",
  path: "/sms-program",
});

export default function SmsProgramPage() {
  return <SmsProgramContent />;
}
