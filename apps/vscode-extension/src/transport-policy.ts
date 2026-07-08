const ABSOLUTE_URL_RE = /^[a-z][a-z\d+\-.]*:\/\//i;

export function resolveCredentialSafeUrl(baseUrl: string, path: string): URL {
  const url = new URL(buildUrl(baseUrl, path));
  const hostname = requestHostnameForUrl(url);
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      `WaitLayer refuses to send credentials over ${url.protocol}. ` +
      "Set 'waitlayer.apiUrl' to an https:// endpoint, or http://localhost for local development.",
    );
  }

  return url;
}

export function requestHostnameForUrl(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function buildUrl(baseUrl: string, path: string): string {
  if (ABSOLUTE_URL_RE.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
