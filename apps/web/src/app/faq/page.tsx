'use client';

import Link from 'next/link';
import { useState } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    question: 'What can I do in the WaitLayer beta?',
    answer:
      'Sign up as a developer, install the VS Code extension or CLI, and authenticate to help validate wait-state detection. Rewards are currently disabled while WaitLayer completes its independently verifiable attestation integration; the client tells you when rewards are unavailable.',
  },
  {
    question: 'What payout methods are supported?',
    answer:
      'No rewards or payouts are available during the beta. For a future launch, the safe defaults are operator-processed manual and PayPal email payouts; automated provider rails remain disabled until their credentials and operational reviews are complete.',
  },
  {
    question: 'How does the revenue split work?',
    answer:
      'If sponsor-funded rewards launch, the standard split will be 60% to the developer, 30% to the platform, and 10% held in a fraud and payment reserve. A reviewed early-adopter launch campaign may use an 80% user, 10% platform, 10% reserve split.',
  },
  {
    question: 'Will WaitLayer collect my code or private information?',
    answer:
      'No. WaitLayer is privacy-first by design. Beta telemetry is limited to the information needed to validate wait-state detection; we never read, transmit, or store your code, prompts, completions, or file names.',
  },
  {
    question: 'Can I choose what ads are shown to me?',
    answer:
      'Yes! You can choose display frequencies, set daily/hourly caps, configure quiet hours, and block specific advertiser categories directly from your settings dashboard.',
  },
];

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleIndex = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-sm tracking-tight">WaitLayer</span>
          </Link>
          <Link
            href="/"
            className="text-surface-500 hover:text-surface-900 text-sm transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </nav>

      {/* Main content */}
      <main id="main-content" tabIndex={-1} className="pt-32 pb-24 px-6 mx-auto max-w-3xl">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-surface-500 text-sm">
            Everything you need to know about the WaitLayer beta and future rewards launch.
          </p>
        </div>

        <div className="space-y-4">
          {FAQS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="border border-surface-200 rounded-2xl overflow-hidden transition-all duration-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggleIndex(index)}
                  className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 font-semibold text-surface-900 hover:bg-surface-50/50 transition-colors"
                >
                  <span className="text-sm">{item.question}</span>
                  <span className="text-surface-400 shrink-0 select-none">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 text-surface-500 text-sm leading-relaxed border-t border-surface-100 pt-3">
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
