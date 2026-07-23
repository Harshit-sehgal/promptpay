/**
 * Content-Security-Policy builder for WaitLayer.
 *
 * Kept in a standalone JavaScript module so `next.config.js` (CommonJS) and
 * unit tests can import it without booting the entire Next.js/Sentry
 * configuration.
 */

/**
 * Production Content-Security-Policy template. `{scriptSrc}` is replaced by
 * buildCsp() with the appropriate script-src directive. This keeps the policy
 * as a single source of truth and makes dev/prod injection less fragile than
 * substring replacement.
 */
const CSP_TEMPLATE =
  "default-src 'self'; {scriptSrc}; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.sentry.io; frame-src 'self' https://accounts.google.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests;";

/**
 * Build the Content-Security-Policy value. In development we add
 * 'unsafe-eval' so Next.js/React Fast Refresh can evaluate modules and
 * source maps; this is removed in production builds where eval is not
 * required and is a security anti-pattern.
 */
function buildCsp() {
  const isDev = process.env.NODE_ENV === 'development';
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com/gsi/client"
    : "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client";
  return CSP_TEMPLATE.replace('{scriptSrc}', scriptSrc);
}

module.exports = { buildCsp };
