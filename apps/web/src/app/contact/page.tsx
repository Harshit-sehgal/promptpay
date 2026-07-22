import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Contact & Support — WaitLayer',
  description:
    'Get help with your WaitLayer account, payouts, campaigns, or trust score. Reach the support team or browse policy pages.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-sm tracking-tight">WaitLayer</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="text-surface-600 hover:text-surface-900 text-sm font-medium transition-colors px-3 py-1.5"
            >
              Log in
            </Link>
            <Link
              href="/auth/signup?role=developer"
              className="bg-surface-900 hover:bg-surface-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Join beta
            </Link>
          </div>
        </div>
      </nav>

      <main id="main-content" tabIndex={-1} className="pt-36 pb-24 px-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-4">
            Contact & Support
          </h1>
          <p className="text-surface-500 text-lg mb-12">
            We're here to help with accounts, payouts, campaigns, and trust scoring.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
            <div className="bg-white border border-surface-200/80 rounded-2xl p-7">
              <h2 className="text-surface-900 font-semibold text-base mb-2">Email support</h2>
              <p className="text-surface-500 text-sm leading-relaxed mb-3">
                For account, payout, and campaign questions.
              </p>
              <a
                href="mailto:support@waitlayer.com"
                className="text-brand-600 font-medium text-sm hover:underline"
              >
                support@waitlayer.com
              </a>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-2xl p-7">
              <h2 className="text-surface-900 font-semibold text-base mb-2">Security reports</h2>
              <p className="text-surface-500 text-sm leading-relaxed mb-3">
                Report vulnerabilities or abuse responsibly.
              </p>
              <a
                href="mailto:security@waitlayer.com"
                className="text-brand-600 font-medium text-sm hover:underline"
              >
                security@waitlayer.com
              </a>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-2xl p-7">
              <h2 className="text-surface-900 font-semibold text-base mb-2">
                Trust & verification
              </h2>
              <p className="text-surface-500 text-sm leading-relaxed mb-3">
                Questions about trust scores or hold periods.
              </p>
              <a
                href="mailto:trust@waitlayer.com"
                className="text-brand-600 font-medium text-sm hover:underline"
              >
                trust@waitlayer.com
              </a>
            </div>
          </div>

          <div className="bg-surface-50/60 border border-surface-200/80 rounded-2xl p-8">
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
            two-factor codes with anyone — WaitLayer support will never ask for them.
          </p>
        </div>
      </main>
    </div>
  );
}
