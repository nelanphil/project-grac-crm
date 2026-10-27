export type NgrokTunnel = {
  public_url?: string;
  proto?: string;
  config?: { addr?: string };
};

function addrUsesPort(addr: string, port: number): boolean {
  const host = addr.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  return host === String(port) || host.endsWith(`:${port}`);
}

/** Public origin of the ngrok tunnel that forwards to this API port. Prefers https. */
export function publicBaseForLocalPort(
  tunnels: NgrokTunnel[],
  port: number,
): string | null {
  const matches = tunnels.filter((tunnel) => {
    const publicUrl = tunnel.public_url?.trim() ?? "";
    if (!publicUrl.startsWith("https://") && !publicUrl.startsWith("http://")) return false;
    return addrUsesPort(tunnel.config?.addr ?? "", port);
  });
  const chosen =
    matches.find((tunnel) => tunnel.public_url?.startsWith("https://")) ?? matches[0];
  if (!chosen?.public_url) return null;
  try {
    return new URL(chosen.public_url).origin;
  } catch {
    return null;
  }
}
