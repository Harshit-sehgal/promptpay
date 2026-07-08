'use client';

import Link from 'next/link';

import { openCookieSettings } from './cookie-consent';

export default function SiteFooter() {
  return (
    <footer className="border-t border-surface-200 bg-surface-50">
      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-surface-400 text-[12px]">
          © {new Date().getFullYear()} WaitLayer. All rights reserved.
        </p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <Link href="/privacy" className="text-surface-500 hover:text-surface-700 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/legal/gdpr-dpa" className="text-surface-500 hover:text-surface-700 transition-colors">
            GDPR DPA
          </Link>
          <Link
            href="/privacy#ccpa"
            className="text-surface-500 hover:text-surface-700 transition-colors"
          >
            Do Not Sell My Personal Information
          </Link>
          <Link href="/feedback" className="text-surface-500 hover:text-surface-700 transition-colors">
            Feedback
          </Link>
          <button
            type="button"
            onClick={openCookieSettings}
            className="text-surface-500 hover:text-surface-700 transition-colors underline underline-offset-2"
          >
            Cookie Settings
          </button>
        </nav>
      </div>
    </footer>
  );
}
