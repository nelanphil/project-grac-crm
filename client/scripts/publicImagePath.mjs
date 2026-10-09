/** Paths like `/images/mu2y7d4r-6xjl2f` (optional trailing slash). Dots are excluded so static files such as `generac-product-lineup.jpg` are not proxied. */
export const PUBLIC_IMAGE_SLUG_PATH =
  /^\/(?:images|public-assets)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i;

export function publicAssetSlugFromPath(pathname) {
  const match = PUBLIC_IMAGE_SLUG_PATH.exec(pathname);
  return match ? match[1].toLowerCase() : null;
}
