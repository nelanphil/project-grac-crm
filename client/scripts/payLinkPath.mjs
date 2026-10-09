/** Paths like `/p/Ab12Cd34` (optional trailing slash). */
export const PAY_CODE_PATH = /^\/p\/([A-Za-z0-9_-]+)\/?$/;

export function payCodeFromPath(pathname) {
  const match = PAY_CODE_PATH.exec(pathname);
  return match ? match[1] : null;
}
