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
  ['How it works', '/#how-it-works'],
  ['Privacy', '/#privacy'],
  ['Sponsors', '/#sponsors'],
  ['Pricing', '/pricing'],
  ['Comparison', '/comparison'],
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

export default function SiteFooter() {
  const docsUrl = apiDocsUrl();

  return (
    <footer className="site-footer">
      <div className="mx-auto max-w-[1240px] px-5 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="site-footer__lead">
          <Link href="/" aria-label="Ateva home" className="site-footer__brand">
            <span className="site-footer__mark">
              <BrandMark size={16} />
            </span>
            <span className="site-footer__wordmark">Ateva</span>
          </Link>
          <p className="site-footer__description">
            Delivery verification for explicitly integrated AI-agent workflows.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-8 py-10 sm:gap-10 lg:grid-cols-[1.4fr_1fr_1.35fr_1fr] lg:gap-12 lg:py-12">
          <div>
            <p className="site-footer__heading">Product boundary</p>
            <p className="site-footer__note">
              No source-code access. No prompt access. No terminal-output collection.
            </p>
          </div>

          <div>
            <p className="site-footer__heading">Product</p>
            <ul className="site-footer__list">
              {PRODUCT_LINKS.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="site-footer__link">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="site-footer__heading">Resources</p>
            <ul className="site-footer__list">
              {docsUrl && (
                <li>
                  <a
                    href={docsUrl}
                    className="site-footer__link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    API docs
                  </a>
                </li>
              )}
              {RESOURCE_LINKS.map(([label, href]) => (
                <li
                  key={href}
                  className={
                    label === 'Do Not Sell or Share My Personal Information'
                      ? 'col-span-2 sm:col-span-1'
                      : undefined
                  }
                >
                  <Link href={href} className="site-footer__link">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="site-footer__heading">Company</p>
            <ul className="site-footer__list">
              {COMPANY_LINKS.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="site-footer__link">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="site-footer__base">
          <span>© {new Date().getFullYear()} Ateva</span>
          <button type="button" onClick={openCookieSettings} className="site-footer__cookie">
            Cookie settings
          </button>
          <span>Private beta · rewards disabled</span>
        </div>
      </div>
    </footer>
  );
}
