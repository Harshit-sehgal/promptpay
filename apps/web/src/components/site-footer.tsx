'use client';

import Link from 'next/link';
import { openCookieSettings } from '@/components/cookie-consent';

export default function SiteFooter() {
  return (
    <footer
      id="faq"
      style={{ borderTop: '1px solid #ececec', background: '#fafafa', padding: '64px 0 48px' }}
    >
      <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
        <div
          className="wl-2col"
          style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '40px' }}
        >
          <div>
            <Link
              href="/"
              style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}
            >
              <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="0" y="1.5" width="16" height="2.4" rx="0.4" fill="#0a0a0a" />
                <rect x="0" y="6.8" width="16" height="2.4" rx="0.4" fill="#0a0a0a" />
                <rect
                  x="0"
                  y="12.1"
                  width="11"
                  height="2.4"
                  rx="0.4"
                  fill="var(--accent,#16a34a)"
                />
              </svg>
              <span style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.01em' }}>
                WaitLayer
              </span>
            </Link>
            <p
              style={{
                fontSize: '14px',
                lineHeight: 1.6,
                color: '#777',
                maxWidth: '280px',
                margin: 0,
              }}
            >
              The verified attention network for AI coding agents.
            </p>
          </div>
          <div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '11px',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#aaa',
                marginBottom: '16px',
              }}
            >
              Product
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '11px',
                fontSize: '14px',
                color: '#555',
              }}
            >
              <li>
                <Link href="/#developers" className="wl-link-u">
                  Developers
                </Link>
              </li>
              <li>
                <Link href="/#sponsors" className="wl-link-u">
                  Sponsors
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="wl-link-u">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/#trust" className="wl-link-u">
                  Trust
                </Link>
              </li>
              <li>
                <Link href="/comparison" className="wl-link-u">
                  Roadmap
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '11px',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#aaa',
                marginBottom: '16px',
              }}
            >
              Resources
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '11px',
                fontSize: '14px',
                color: '#555',
              }}
            >
              <li>
                <Link
                  href="http://localhost:4002/api/v1/docs"
                  className="wl-link-u"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Docs
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="wl-link-u">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="wl-link-u">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/payout-policy" className="wl-link-u">
                  Payout Policy
                </Link>
              </li>
              <li>
                <Link href="/advertiser-policy" className="wl-link-u">
                  Advertiser Policy
                </Link>
              </li>
              <li>
                <Link href="/legal/cookie-policy" className="wl-link-u">
                  Cookie Policy
                </Link>
              </li>
              <li>
                <Link href="/legal/data-retention" className="wl-link-u">
                  Data retention
                </Link>
              </li>
              <li>
                <Link href="/privacy#ccpa" className="wl-link-u">
                  Do Not Sell or Share My Personal Information
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '11px',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#aaa',
                marginBottom: '16px',
              }}
            >
              Company
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '11px',
                fontSize: '14px',
                color: '#555',
              }}
            >
              <li>
                <Link href="/manifesto" className="wl-link-u">
                  Manifesto
                </Link>
              </li>
              <li>
                <Link href="/changelog" className="wl-link-u">
                  Changelog
                </Link>
              </li>
              <li>
                <Link href="/contact" className="wl-link-u">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div
          style={{
            marginTop: '48px',
            paddingTop: '24px',
            borderTop: '1px solid #e6e6e6',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: '#888' }}
          >
            No code access. No prompt access. No terminal-output collection.
          </span>
          <button
            type="button"
            onClick={openCookieSettings}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '12px',
              color: '#555',
              background: 'none',
              border: '1px solid #ddd',
              borderRadius: '6px',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Cookie Settings
          </button>
          <span
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: '#aaa' }}
          >
            © {new Date().getFullYear()} WaitLayer
          </span>
        </div>
      </div>
    </footer>
  );
}
