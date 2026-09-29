import ShortPayRedirect from "./ShortPayRedirect";

export function generateStaticParams() {
  return [{ code: "preview" }];
}

export const dynamicParams = false;

export default async function ShortPayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <ShortPayRedirect code={code} />;
}
