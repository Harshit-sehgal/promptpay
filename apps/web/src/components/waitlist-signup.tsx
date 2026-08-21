'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';

import { useToast } from '@ateva/ui';

/**
 * Advertiser waitlist signup form (LAUNCH_PLAN Phase 2 step 11).
 *
 * Submits to the API through the BFF proxy (allowlisted path
 * `/marketing/waitlist`). Client-side behaviour mirrors the feedback page
 * (A-078): a failed submit must NOT show the "recorded" success state and
 * must NOT discard the user's draft.
 *
 * The honeypot (`website`) is deliberately hidden from humans and visible to
 * bots; the server rejects any submission that fills it.
 */
export function WaitlistSignup() {
  const { success, error: showError } = useToast();
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !consent) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/marketing/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          company: company || undefined,
          country: country || undefined,
          consent,
        }),
      });
      if (!res.ok) throw new Error('waitlist submit failed');
      setSent(true);
      success("You're on the waitlist!");
    } catch {
      setSent(false);
      showError('We could not add you just now. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div
        role="status"
        className="bg-green-50 border border-green-200 rounded-2xl p-6 text-green-700 text-sm"
      >
        You&rsquo;re on the advertiser waitlist. We&rsquo;ll email you when billing opens and
        founding sponsors are invited.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Advertiser waitlist signup">
      <div>
        <label htmlFor="wl-email" className="text-surface-700 text-sm font-medium mb-1.5 block">
          Work email
        </label>
        <input
          id="wl-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="wl-company" className="text-surface-700 text-sm font-medium mb-1.5 block">
            Company <span className="text-surface-400">(optional)</span>
          </label>
          <input
            id="wl-company"
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Inc."
            autoComplete="organization"
            className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label htmlFor="wl-country" className="text-surface-700 text-sm font-medium mb-1.5 block">
            Country <span className="text-surface-400">(optional)</span>
          </label>
          <input
            id="wl-country"
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="US"
            maxLength={2}
            autoComplete="country"
            aria-describedby="wl-country-hint"
            className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          <p id="wl-country-hint" className="text-surface-400 text-xs mt-1">
            Two-letter ISO code.
          </p>
        </div>
      </div>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500"
        />
        <span className="text-surface-600 text-sm leading-relaxed">
          I agree to receive email updates about Ateva advertiser availability. I can opt out at any
          time.
        </span>
      </label>
      {/* Honeypot — hidden from humans, visible to bots. Server rejects if filled. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="wl-website">Website</label>
        <input id="wl-website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <Button
        type="submit"
        variant="brand"
        size="lg"
        disabled={!email.trim() || !consent || submitting}
        isLoading={submitting}
        className="w-full rounded-xl text-sm"
      >
        {submitting ? 'Adding you…' : 'Join the advertiser waitlist'}
      </Button>
    </form>
  );
}
