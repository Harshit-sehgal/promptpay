import Link from 'next/link';
import { WaitlistSignup } from '@/components/waitlist-signup';

export default function AdvertisersPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-sm tracking-tight">Ateva</span>
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
        <div className="mx-auto max-w-4xl">
          <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-4">
            Advertise in the moments that matter
          </h1>
          <p className="text-surface-500 text-lg leading-relaxed mb-8 max-w-2xl">
            Ateva reaches developers while they wait for builds, tests, and deployments — their most
            focused, screen-on moments. We&rsquo;re in private beta, so advertising is not open yet.
            Join the waitlist to secure a founding sponsor slot.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
            {[
              [
                'Attentive moments',
                'Captive, non-skippable wait states during real developer work',
              ],
              ['Founding terms', 'Priority pricing and discounted founding CPMs'],
              ['Category exclusivity', 'One sponsor per category during the beta'],
            ].map(([title, body]) => (
              <div
                key={title}
                className="bg-surface-50/60 border border-surface-200/80 rounded-2xl p-6"
              >
                <h2 className="text-surface-900 font-semibold text-sm mb-2">{title}</h2>
                <p className="text-surface-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-surface-200/80 rounded-2xl p-8 shadow-sm max-w-xl">
            <h2 className="text-surface-900 font-bold text-lg mb-1.5">
              Join the advertiser waitlist
            </h2>
            <p className="text-surface-500 text-sm leading-relaxed mb-6">
              Billing is closed during the private beta. Leave your details and we&rsquo;ll reach
              out before we open advertising to new sponsors.
            </p>
            <WaitlistSignup />
          </div>

          <div className="mt-10 flex flex-wrap gap-5 text-sm">
            <Link href="/advertiser-policy" className="text-brand-700 font-medium hover:underline">
              Advertiser Policy
            </Link>
            <Link href="/pricing" className="text-brand-700 font-medium hover:underline">
              See pricing
            </Link>
            <Link href="/faq" className="text-brand-700 font-medium hover:underline">
              FAQ
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
