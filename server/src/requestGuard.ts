const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Strip a trailing `:port` from a Host header value, preserving bracketed IPv6. */
function stripPort(host: string): string {
  if (host.startsWith('[')) {
    // Bracketed IPv6, optionally followed by :port — e.g. `[::1]:5199`.
    const closeIdx = host.indexOf(']');
    return closeIdx === -1 ? host : host.slice(0, closeIdx + 1);
  }
  const lastColon = host.lastIndexOf(':');
  // A bare (unbracketed) IPv6 literal has multiple colons and no port suffix to strip.
  if (lastColon === -1 || host.indexOf(':') !== lastColon) return host;
  return host.slice(0, lastColon);
}

/** True when the Host header points at this machine (loopback names only). */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  return LOOPBACK_HOSTNAMES.has(stripPort(host.toLowerCase()));
}

/** True when the Origin header is absent (non-browser client) or loopback. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
