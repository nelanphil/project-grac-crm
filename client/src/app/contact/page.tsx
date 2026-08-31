import type { Metadata } from "next";
import ContactForm from "@/components/contact/ContactForm";
import { COMPANY } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Contact Us — ${COMPANY.name}`,
  description:
    "Send a message to Generator Maintenance of Florida. We'll get back to you shortly.",
};

export default function ContactPage() {
  return <ContactForm />;
}
