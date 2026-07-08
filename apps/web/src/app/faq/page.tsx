'use client';

import Link from 'next/link';
import { useState } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    question: 'How do I start earning with WaitLayer?',
    answer: 'Simply sign up as a developer, install our VS Code extension or lightweight CLI, and authenticate. Once active, sponsored messages will appear during the short compilation, test execution, or deployment wait states in your editor or terminal.'
  },
  {
    question: 'What payout methods are supported?',
    answer: 'WaitLayer currently supports PayPal-first payouts. We are actively building integrations for Stripe, Wise, and other global payout methods to accommodate developers around the world.'
  },
  {
    question: 'How does the revenue split work?',
    answer: 'By default, the revenue split is 60% to the developer, 30% to the platform, and 10% held in a fraud and payment reserve. During special early-adopter launch phases, campaigns configured with the launch incentive yield an 80% user, 10% platform, 10% reserve split.'
  },
  {
    question: 'Will WaitLayer collect my code or private information?',
    answer: 'No. WaitLayer is privacy-first by design. We only track visible sponsored message duration and interactions to calculate rewards. We never read, transmit, or store your code, prompts, completions, or file names.'
  },
  {
    question: 'Can I choose what ads are shown to me?',
    answer: 'Yes! You can choose display frequencies, set daily/hourly caps, configure quiet hours, and block specific advertiser categories directly from your settings dashboard.'
  }
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
            <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
          </Link>
          <Link href="/" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">
            ← Back to Home
          </Link>
        </div>
      </nav>

      {/* Main content */}
      <main className="pt-32 pb-24 px-6 mx-auto max-w-3xl">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-4">Frequently Asked Questions</h1>
          <p className="text-surface-500 text-sm">
            Everything you need to know about earning from AI wait time.
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
                  <span className="text-[15px]">{item.question}</span>
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
