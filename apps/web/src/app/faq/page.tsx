'use client';

import { useState } from 'react';
import { SiteHeader } from '@/components/site-header';

interface FAQItem {
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    question: 'What can I do in the Ateva beta?',
    answer:
      'Sign up as a developer, install the VS Code extension or CLI, and authenticate to help validate wait-state detection. Rewards are currently disabled while Ateva completes its independently verifiable attestation integration; the client tells you when rewards are unavailable.',
  },
  {
    question: 'What payout methods are supported?',
    answer:
      'No rewards or payouts are available during the beta. For a future launch, the safe defaults are operator-processed manual and PayPal email payouts; automated provider rails remain disabled until their credentials and operational reviews are complete.',
  },
  {
    question: 'How is participant compensation determined?',
    answer:
      'Rewards are disabled in the private beta. If they launch, the rate is 60% of the qualifying bid for a verified impression, with Ateva retaining 40%. That amount is owed by Ateva rather than being a claim on any individual advertiser payment: an advertiser transaction settles in full to Ateva, and participant compensation is paid separately through an approved fiat payout provider.',
  },
  {
    question: 'Will Ateva collect my code or private information?',
    answer:
      'No. Ateva is privacy-first by design. Beta telemetry is limited to the information needed to validate wait-state detection; we never read, transmit, or store your code, prompts, completions, or file names.',
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
      <SiteHeader />

      {/* Main content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-3xl px-5 py-20 sm:px-6 lg:py-24"
      >
        <div className="text-center mb-16">
          <h1 className="font-serif text-4xl md:text-[44px] font-normal leading-[1.15] tracking-[-0.015em] text-surface-950 mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-surface-500 text-sm">
            Everything you need to know about the Ateva beta and future rewards launch.
          </p>
        </div>

        <div className="space-y-4">
          {FAQS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="border border-surface-200 rounded-3xl overflow-hidden transition-all duration-200 bg-white"
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
