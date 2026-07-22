'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';

import { useToast } from '@waitlayer/ui';

export default function FeedbackPage() {
  const { success, error: showError } = useToast();
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          rating: rating ?? undefined,
          category: 'other',
        }),
      });
      if (!res.ok) throw new Error('feedback submit failed');
      setSent(true);
      setMessage('');
      setRating(null);
      success('Thanks for your feedback!');
    } catch {
      // A-078: a failed submit must NOT show the "recorded" success state and
      // must NOT discard the user's draft. Keep the message + rating so the
      // user can retry; only surface a retryable error.
      setSent(false);
      showError('We could not deliver your feedback just now. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface-50">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          href="/"
          className="text-brand-500 hover:text-brand-600 text-xs font-medium focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:rounded focus-visible:outline-none"
        >
          ← Back
        </Link>
        <h1 className="text-3xl font-bold text-surface-900 mt-4 mb-2 tracking-tight">
          Share your feedback
        </h1>
        <p className="text-surface-500 text-sm mb-10">
          We read every message. Tell us what works, what doesn&rsquo;t, or what you&rsquo;d like to
          see next.
        </p>

        {sent ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-green-700 text-sm">
            Your feedback has been recorded. Thank you!
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                How are we doing?
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`Rate ${n}`}
                    className={`w-10 h-10 rounded-xl text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                      rating === n
                        ? 'bg-brand-500 text-white'
                        : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                Your message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={5}
                placeholder="Your thoughts…"
                className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 transition-all placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
              />
            </div>
            <Button
              type="submit"
              variant="brand"
              size="lg"
              disabled={!message.trim() || submitting}
              isLoading={submitting}
              className="w-full rounded-xl text-sm"
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
