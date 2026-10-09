import type { Metadata } from "next";
import ServiceLanding from "@/components/seo/ServiceLanding";
import { requireService } from "@/lib/seo/services";
import { pageMetadata } from "@/lib/seo/site";

const service = requireService("generator-repair");

export const metadata: Metadata = pageMetadata({
  title: service.title,
  description: service.description,
  path: service.path,
});

export default function GeneratorRepairPage() {
  return <ServiceLanding service={service} />;
}
