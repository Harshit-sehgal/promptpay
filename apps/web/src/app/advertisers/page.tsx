import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { WaitlistSignup } from '@/components/waitlist-signup';

const SPONSOR_NOTES = [
  {
    title: 'Attentive moments',
    body: 'Eligible wait states during real developer workflows, with the sponsored unit clearly labelled.',
  },
  {
    title: 'Verified delivery',
    body: 'A view reaches reporting only after render, visibility, session, duplicate, and fraud checks pass.',
  },
  {
    title: 'Founding access',
    body: 'Private-beta sponsors receive early access to campaign tooling before live billing opens.',
  },
];

export default function AdvertisersPage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <main
        id="main-content"
        tabIndex={-1}
        className="relative overflow-hidden px-5 py-16 sm:px-6 lg:px-8 lg:py-24"
      >
        <div
          aria-hidden="true"
          className="absolute right-[4%] top-[10%] h-80 w-80 rounded-full bg-brand-50 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-[1240px] gap-14 lg:grid-cols-[.9fr_1.1fr] lg:items-start lg:gap-20">
          <div className="lg:pt-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-600">
              Advertiser access · private beta
            </p>
            <h1 className="mt-5 max-w-2xl text-balance font-serif text-[clamp(3.25rem,6.5vw,5.25rem)] font-normal leading-[0.98] tracking-[-0.04em] text-surface-950">
              Advertise in the moments that{' '}
              <em className="font-normal italic text-brand-600">matter.</em>
            </h1>
            <p className="mt-7 max-w-xl text-[17px] leading-8 text-surface-600">
              Ateva reaches developers while they wait for builds, tests, and deployments.
              Advertising is not open yet; join the waitlist to review founding-sponsor access
              before billing is enabled.
            </p>

            <dl className="mt-10 border-y border-surface-200/80">
              {SPONSOR_NOTES.map((note, index) => (
                <div
                  key={note.title}
                  className="grid gap-2 border-b border-surface-200/80 py-5 last:border-b-0 sm:grid-cols-[32px_150px_1fr] sm:items-start sm:gap-4"
                >
                  <dt className="contents">
                    <span className="font-mono text-[10px] text-brand-600">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-sm font-semibold text-surface-900">{note.title}</span>
                  </dt>
                  <dd className="m-0 text-[13px] leading-5 text-surface-500">{note.body}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <Link href="/advertiser-policy" className="wl-link-u font-medium text-brand-700">
                Advertiser policy →
              </Link>
              <Link href="/pricing" className="wl-link-u font-medium text-brand-700">
                Beta pricing →
              </Link>
              <Link href="/faq" className="wl-link-u font-medium text-brand-700">
                FAQ →
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[620px] lg:mx-0 lg:ml-auto">
            <div
              aria-hidden="true"
              className="absolute -bottom-5 -right-5 h-[80%] w-[82%] rounded-[32px] bg-brand-100/75 sm:-bottom-7 sm:-right-7"
            />
            <section className="relative rounded-[30px] border border-surface-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(23,25,28,0.04),0_24px_70px_-32px_rgba(23,25,28,0.28)] sm:p-9">
              <div className="mb-7 border-b border-surface-200/80 pb-6">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-surface-400">
                  Founding sponsor register
                </p>
                <h2 className="mt-3 font-serif text-3xl font-normal tracking-[-0.025em] text-surface-950 sm:text-4xl">
                  Join the advertiser waitlist
                </h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-surface-500">
                  Billing is closed during the private beta. Leave your details and we&rsquo;ll
                  reach out before advertising opens to new sponsors.
                </p>
              </div>
              <WaitlistSignup />
              <p className="mt-6 border-t border-surface-200/80 pt-5 font-mono text-[9px] uppercase tracking-[0.11em] text-surface-400">
                No charge · no campaign activation · consent required
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
