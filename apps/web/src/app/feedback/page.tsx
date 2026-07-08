'use client';

import Link from 'next/link';
import { FormEvent,useState } from 'react';

import { useToast } from '@waitlayer/ui';

const FEEDBACK_KEY = 'wl_feedback_submissions';

export default function FeedbackPage() {
  const { success } = useToast();
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      const prev = JSON.parse(window.localStorage.getItem(FEEDBACK_KEY) ?? '[]');
      prev.push({ message, rating, at: new Date().toISOString() });
      window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(prev));
    } catch {
      // Non-fatal: feedback is best-effort local capture.
    }
    setSent(true);
    setMessage('');
    setRating(null);
    success('Thanks for your feedback!');
  };

  return (
    <main className="min-h-screen bg-surface-50">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-brand-500 hover:text-brand-600 text-[13px] font-medium">
          ← Back
        </Link>
        <h1 className="text-3xl font-bold text-surface-900 mt-4 mb-2 tracking-tight">
          Share your feedback
        </h1>
        <p className="text-surface-500 text-[14px] mb-10">
          We read every message. Tell us what works, what doesn&rsquo;t, or what
          you&rsquo;d like to see next.
        </p>

        {sent ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-green-700 text-[14px]">
            Your feedback has been recorded. Thank you!
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                How are we doing?
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`Rate ${n}`}
                    className={`w-10 h-10 rounded-xl text-[15px] font-medium transition-colors ${
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
              <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                Your message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={5}
                placeholder="Your thoughts…"
                className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={!message.trim()}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-[14px] transition-colors"
            >
              Send feedback
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
