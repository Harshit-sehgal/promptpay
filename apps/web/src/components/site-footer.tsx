'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { openCookieSettings } from '@/components/cookie-consent';

function apiDocsUrl(): string | null {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return null;

  try {
    const url = new URL(apiUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/docs`;
    return url.toString();
  } catch {
    return null;
  }
}

const PRODUCT_LINKS = [
  ['Developers', '/#developers'],
  ['Sponsors', '/#sponsors'],
  ['Pricing', '/pricing'],
  ['Trust', '/#trust'],
  ['Roadmap', '/comparison'],
] as const;

const RESOURCE_LINKS = [
  ['System status', '/status'],
  ['Privacy policy', '/privacy'],
  ['Terms', '/terms'],
  ['Payout policy', '/payout-policy'],
  ['Advertiser policy', '/advertiser-policy'],
  ['Cookie policy', '/legal/cookie-policy'],
  ['Data retention', '/legal/data-retention'],
  ['Do Not Sell or Share My Personal Information', '/privacy#ccpa'],
] as const;

const COMPANY_LINKS = [
  ['Manifesto', '/manifesto'],
  ['Changelog', '/changelog'],
  ['Contact', '/contact'],
] as const;

const linkClass =
  'wl-link-u w-fit rounded-sm text-[13px] leading-5 text-surface-600 transition-colors hover:text-surface-950';

export default function SiteFooter() {
  const docsUrl = apiDocsUrl();

  return (
    <footer className="border-t border-surface-200/80 bg-surface-50">
      <div className="mx-auto max-w-[1240px] px-5 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-col justify-between gap-8 border-b border-surface-200/80 pb-12 lg:flex-row lg:items-end">
          <div>
            <Link
              href="/"
              aria-label="Ateva home"
              className="inline-flex items-center gap-2.5 rounded-full focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-4"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-950 text-white">
                <BrandMark size={16} />
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.02em] text-surface-950">
                Ateva
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-surface-500">
              Privacy-first wait-signal verification for explicitly integrated AI-agent workflows.
            </p>
          </div>
          <p className="max-w-xl text-balance font-serif text-3xl leading-[1.08] tracking-[-0.025em] text-surface-950 sm:text-4xl lg:text-right">
            The wait becomes visible.{' '}
            <em className="font-normal italic text-brand-600">The work stays private.</em>
          </p>
        </div>

        <div className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.35fr_1fr] lg:gap-12">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
              Product boundary
            </p>
            <p className="mt-4 max-w-[250px] text-[13px] leading-6 text-surface-600">
              No source-code access. No prompt access. No terminal-output collection.
            </p>
          </div>

          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
              Product
            </p>
            <ul className="mt-4 space-y-2.5">
              {PRODUCT_LINKS.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className={linkClass}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
              Resources
            </p>
            <ul className="mt-4 space-y-2.5">
              {docsUrl && (
                <li>
                  <a href={docsUrl} className={linkClass} target="_blank" rel="noopener noreferrer">
                    API docs
                  </a>
                </li>
              )}
              {RESOURCE_LINKS.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className={linkClass}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
              Company
            </p>
            <ul className="mt-4 space-y-2.5">
              {COMPANY_LINKS.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className={linkClass}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-surface-200/80 pt-6 font-mono text-[11px] uppercase tracking-[0.1em] text-surface-400 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Ateva</span>
          <button
            type="button"
            onClick={openCookieSettings}
            className="w-fit rounded-full border border-surface-300 px-3.5 py-2 text-surface-600 transition-colors hover:border-surface-500 hover:text-surface-950"
          >
            Cookie settings
          </button>
          <span>Private beta · rewards disabled</span>
        </div>
      </div>
    </footer>
  );
}
