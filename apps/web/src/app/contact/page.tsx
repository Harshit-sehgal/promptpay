import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Contact & Support — Ateva',
  description:
    'Get help with your Ateva account, payouts, campaigns, or trust score. Reach the support team or browse policy pages.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className="px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-serif text-4xl md:text-[44px] font-normal leading-[1.15] tracking-[-0.015em] text-surface-950 mb-4">
            Contact & Support
          </h1>
          <p className="text-surface-500 text-lg mb-12">
            We're here to help with accounts, payouts, campaigns, and trust scoring.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
            <div className="bg-white border border-surface-200/80 rounded-3xl p-7">
              <h2 className="text-surface-900 font-semibold text-base mb-2">Email support</h2>
              <p className="text-surface-500 text-sm leading-relaxed mb-3">
                For account, payout, and campaign questions.
              </p>
              <Link href="/feedback" className="text-brand-700 font-medium text-sm hover:underline">
                Open the feedback form
              </Link>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-3xl p-7">
              <h2 className="text-surface-900 font-semibold text-base mb-2">Security reports</h2>
              <p className="text-surface-500 text-sm leading-relaxed mb-3">
                Report vulnerabilities or abuse responsibly.
              </p>
              <Link href="/feedback" className="text-brand-700 font-medium text-sm hover:underline">
                Report via the feedback form
              </Link>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-3xl p-7">
              <h2 className="text-surface-900 font-semibold text-base mb-2">
                Trust & verification
              </h2>
              <p className="text-surface-500 text-sm leading-relaxed mb-3">
                Questions about trust scores or hold periods.
              </p>
              <Link href="/feedback" className="text-brand-700 font-medium text-sm hover:underline">
                Ask via the feedback form
              </Link>
            </div>
          </div>

          <div className="bg-surface-50/60 border border-surface-200/80 rounded-3xl p-8">
            <h2 className="text-surface-900 font-bold text-[16px] mb-4">Helpful links</h2>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/privacy"
                className="text-surface-600 hover:text-surface-900 text-sm font-medium"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-surface-600 hover:text-surface-900 text-sm font-medium"
              >
                Terms of Service
              </Link>
              <Link
                href="/payout-policy"
                className="text-surface-600 hover:text-surface-900 text-sm font-medium"
              >
                Payout Policy
              </Link>
              <Link
                href="/advertiser-policy"
                className="text-surface-600 hover:text-surface-900 text-sm font-medium"
              >
                Advertiser Policy
              </Link>
              <Link
                href="/faq"
                className="text-surface-600 hover:text-surface-900 text-sm font-medium"
              >
                FAQ
              </Link>
              <Link
                href="/security"
                className="text-surface-600 hover:text-surface-900 text-sm font-medium"
              >
                Security
              </Link>
            </div>
          </div>

          <p className="text-surface-400 text-xs mt-8 leading-relaxed">
            Response times are typically within two business days. Never share your password or
            two-factor codes with anyone — Ateva support will never ask for them.
          </p>
        </div>
      </main>
    </div>
  );
}
