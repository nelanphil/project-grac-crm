import type { Metadata } from "next";
import ContactForm from "@/components/contact/ContactForm";
import { pageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = pageMetadata({
  title: "Contact Us",
  description:
    "Send a message to Generator Maintenance of Florida. We'll get back to you shortly.",
  path: "/contact",
});

export default function ContactPage() {
  return <ContactForm />;
}
