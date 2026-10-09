export class PublicAssetProxyError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "PublicAssetProxyError";
    this.status = status;
  }
}

/** Only stored Cloudinary HTTPS URLs may be fetched server-side (SSRF guard). */
export function isAllowedPublicAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "cloudinary.com" || host.endsWith(".cloudinary.com");
  } catch {
    return false;
  }
}

export async function fetchPublicAssetMedia(publicUrl: string): Promise<{
  contentType: string | null;
  contentLength: string | null;
  body: ReadableStream<Uint8Array>;
}> {
  if (!isAllowedPublicAssetUrl(publicUrl)) {
    throw new PublicAssetProxyError("Image source is not allowed.");
  }

  const upstream = await fetch(publicUrl);
  if (upstream.url && !isAllowedPublicAssetUrl(upstream.url)) {
    throw new PublicAssetProxyError("Image source is not allowed.");
  }
  if (!upstream.ok || !upstream.body) {
    throw new PublicAssetProxyError("Unable to retrieve the image.");
  }

  return {
    contentType: upstream.headers.get("content-type"),
    contentLength: upstream.headers.get("content-length"),
    body: upstream.body,
  };
}
