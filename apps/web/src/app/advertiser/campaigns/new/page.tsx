'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi, campaignApi } from '@/lib/api/services';

const BID_TYPES = ['cpm', 'cpc'] as const;
const CATEGORIES = ['developer_tools', 'ai_ml', 'cloud_infra', 'saas', 'education', 'other'] as const;

interface CampaignCreateResponse {
  id: string;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Campaign basics
  const [name, setName] = useState('');
  const [bidType, setBidType] = useState<string>('cpm');
  const [bidAmount, setBidAmount] = useState('2.00');
  const [budgetTotal, setBudgetTotal] = useState('100.00');
  const [category, setCategory] = useState<string>('developer_tools');
  const [landingUrl, setLandingUrl] = useState('');
  const [targetCountries, setTargetCountries] = useState('');

  // Creative
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [ctaText, setCtaText] = useState('Learn more');
  const [ctaUrl, setCtaUrl] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const bidAmountMinor = Math.round(parseFloat(bidAmount) * 100);
    const budgetTotalMinor = Math.round(parseFloat(budgetTotal) * 100);

    if (isNaN(bidAmountMinor) || bidAmountMinor <= 0) {
      setError('Enter a valid bid amount');
      setSubmitting(false);
      return;
    }
    if (isNaN(budgetTotalMinor) || budgetTotalMinor < 5000) {
      setError('Minimum budget is $50.00');
      setSubmitting(false);
      return;
    }

    try {
      const campaignRes: { data: CampaignCreateResponse } = await advertiserApi.createCampaign({
        name,
        bidType,
        bidAmountMinor,
        budgetTotalMinor,
        currency: 'USD',
        category,
        landingUrl,
      });

      const campaignId = campaignRes.data.id;

      // Add first creative
      const finalCtaUrl = ctaUrl || landingUrl;
      let displayDomain = 'example.com';
      try {
        const urlObj = new URL(finalCtaUrl);
        displayDomain = urlObj.hostname;
      } catch {
        // fallback
      }

      await campaignApi.createCreative(campaignId, {
        title: headline,
        sponsoredMessage: message,
        destinationUrl: finalCtaUrl,
        displayDomain,
      });

      // Set country targeting if provided
      if (targetCountries.trim()) {
        const countries = targetCountries
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        if (countries.length > 0) {
          const payload = countries.map((code) => ({ countryCode: code, include: true }));
          await campaignApi.setCountryTargeting(campaignId, payload);
        }
      }

      // Submit for review
      await advertiserApi.submitCampaign(campaignId);

      setSuccess(true);
      setTimeout(() => router.push('/advertiser/campaigns'), 1500);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create campaign'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Create campaign</h1>
          <p className="text-ink-300 text-sm">
            Set up your ad campaign, creative, and targeting in one step
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 mb-6">
            <p className="text-emerald-400 text-sm">Campaign created and submitted for review!</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8 max-w-3xl">
          {/* Campaign details */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Campaign details</h2>
            <div className="space-y-4">
              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">Campaign name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="My developer tool campaign"
                  autoComplete="off"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">Bid type</label>
                  <select
                    value={bidType}
                    onChange={(e) => setBidType(e.target.value)}
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white"
                  >
                    {BID_TYPES.map((t) => (
                      <option key={t} value={t}>{t.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                    Bid amount (USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    required
                    inputMode="decimal"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                    Total budget (USD)
                  </label>
                  <input
                    type="number"
                    step="1.00"
                    min="50.00"
                    value={budgetTotal}
                    onChange={(e) => setBudgetTotal(e.target.value)}
                    required
                    inputMode="numeric"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                  <p className="text-ink-500 text-xs mt-1">Minimum $50.00</p>
                </div>
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">Landing URL</label>
                <input
                  type="url"
                  value={landingUrl}
                  onChange={(e) => setLandingUrl(e.target.value)}
                  required
                  placeholder="https://your-product.com"
                  autoComplete="url"
                  inputMode="url"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>
          </div>

          {/* Ad creative */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Ad creative</h2>
            <div className="space-y-4">
              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">Headline</label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  required
                  maxLength={50}
                  placeholder="Short, attention-grabbing headline"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
                <p className="text-ink-500 text-xs mt-1">{headline.length}/50 characters</p>
              </div>

              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  maxLength={80}
                  rows={2}
                  placeholder="Max 80 chars — shown during wait states"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
                <p className="text-ink-500 text-xs mt-1">{message.length}/80 characters</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">CTA text</label>
                  <input
                    type="text"
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    required
                    maxLength={25}
                    placeholder="Learn more"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">CTA URL</label>
                  <input
                    type="url"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="Defaults to landing URL"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              {/* Preview */}
              <div className="bg-ink-700/50 rounded-lg p-4 border border-ink-600/20">
                <p className="text-ink-400 text-xs uppercase mb-2">Preview</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium text-sm">{headline || 'Headline'}</p>
                    <p className="text-ink-300 text-sm">{message || 'Ad message text'}</p>
                  </div>
                  <span className="bg-brand-500/20 text-brand-500 px-3 py-1.5 rounded-lg text-xs font-medium">
                    {ctaText || 'Learn more'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Targeting */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Targeting</h2>
            <div>
              <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                Country targeting (comma-separated ISO codes)
              </label>
              <input
                type="text"
                value={targetCountries}
                onChange={(e) => setTargetCountries(e.target.value)}
                placeholder="US, GB, DE (leave empty for all)"
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
              />
              <p className="text-ink-500 text-xs mt-1">
                Empty = worldwide. Use 2-letter ISO codes (US, GB, DE, IN, etc.)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              {submitting ? 'Creating...' : 'Create & submit campaign'}
            </button>
            {submitting && <LoadingSpinner size="sm" />}
          </div>
        </form>
      
</>
);
}
