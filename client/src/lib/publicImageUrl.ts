/** Public, unauthenticated image links live on the client origin. */
export const PUBLIC_IMAGE_PATH_PREFIX = "/images";

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "").replace(/^\/+/, "");
}

/**
 * Canonical origin for copied/shared public image URLs.
 * An explicit origin wins (tests / current window). Otherwise
 * NEXT_PUBLIC_SITE_URL (https://genmaintoffl.com in production).
 */
export function publicImageOrigin(fallbackOrigin = ""): string {
  const explicit = trimSlashes(fallbackOrigin);
  if (explicit) return explicit;
  return trimSlashes(process.env.NEXT_PUBLIC_SITE_URL ?? "");
}

/** `https://genmaintoffl.com/images/<slug>` (or current origin in local dev). */
export function publicImageUrl(slug: string, fallbackOrigin = ""): string {
  const origin = publicImageOrigin(fallbackOrigin);
  const cleanSlug = trimSlashes(slug);
  const path = `${PUBLIC_IMAGE_PATH_PREFIX}/${cleanSlug}`;
  return origin ? `${origin}${path}` : path;
}
