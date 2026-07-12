'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi, campaignApi } from '@/lib/api/services';

import { majorToMinor } from '@waitlayer/shared';

const BID_TYPES = ['cpm', 'cpc'] as const;
const CATEGORIES = [
  'developer_tools',
  'ai_ml',
  'cloud_infra',
  'saas',
  'education',
  'other',
] as const;

interface CampaignCreateResponse {
  id: string;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRecoveryId, setDraftRecoveryId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Campaign basics
  const [name, setName] = useState('');
  const [bidType, setBidType] = useState<string>('cpm');
  const [bidAmount, setBidAmount] = useState('2.00');
  const [budgetTotal, setBudgetTotal] = useState('100.00');
  const [category, setCategory] = useState<string>('developer_tools');
  const [landingUrl, setLandingUrl] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [fundedCurrencies, setFundedCurrencies] = useState<string[]>(['USD']);
  // A-081: populate funded deposit currencies so a non-USD deposit isn't
  // stranded. Default the new campaign to a funded non-USD balance when one
  // exists; otherwise USD.
  useEffect(() => {
    let active = true;
    advertiserApi
      .getBilling()
      .then((res) => {
        if (!active) return;
        const balances = (res.data?.balances ?? []) as Array<{
          currency: string;
          balanceMinor: bigint;
        }>;
        const funded = balances
          .filter((b) => (b.balanceMinor ?? 0) > 0)
          .map((b) => b.currency.toUpperCase());
        setFundedCurrencies(Array.from(new Set(['USD', ...funded])));
        if (funded.length > 0) setCurrency(funded[0]);
      })
      .catch(() => {
        /* leave default USD */
      });
    return () => {
      active = false;
    };
  }, []);
  const [targetCountries, setTargetCountries] = useState('');

  // Creative
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [ctaText, setCtaText] = useState('Learn more');
  const [ctaUrl, setCtaUrl] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDraftRecoveryId(null);
    setSubmitting(true);

    const bidAmountMajor = parseFloat(bidAmount);
    const budgetTotalMajor = parseFloat(budgetTotal);
    const bidAmountMinor = majorToMinor(bidAmountMajor, currency);
    const budgetTotalMinor = majorToMinor(budgetTotalMajor, currency);

    if (isNaN(bidAmountMajor) || bidAmountMinor <= 0n) {
      setError('Enter a valid bid amount');
      setSubmitting(false);
      return;
    }
    if (isNaN(budgetTotalMajor) || budgetTotalMinor < 5000n) {
      setError('Minimum budget is $50.00');
      setSubmitting(false);
      return;
    }

    let campaignCreated: string | null = null;
    try {
      const campaignRes: { data: CampaignCreateResponse } = await advertiserApi.createCampaign({
        name,
        bidType,
        bidAmountMinor,
        budgetTotalMinor,
        currency,
        category,
      });

      const campaignId = campaignRes.data.id;

      // A-051: Track that the campaign was created using a local variable
      // (NOT React state, which would be stale in the catch closure). If a
      // later step fails, we offer a recovery path via the edit page rather
      // than a misleading "Failed to create campaign" error.
      campaignCreated = campaignId;

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
        ctaText: ctaText?.trim() || undefined,
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
      // A-051: If the campaign was created but a later step (creative,
      // targeting, or submit) failed, show a recovery message instead of
      // a generic failure message. Uses the local `campaignCreated` variable
      // (not React state) so the catch block sees the try-block assignment.
      if (campaignCreated) {
        setDraftRecoveryId(campaignCreated);
        setError(
          `Campaign was saved as a draft, but submission failed: ${getErrorMessage(
            err,
            'submission failed',
          )}.`,
        );
      } else {
        setError(getErrorMessage(err, 'Failed to create campaign'));
      }
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
          {draftRecoveryId && (
            <Link
              href={`/advertiser/campaigns/${draftRecoveryId}/edit`}
              className="mt-3 inline-block text-sm font-medium text-red-200 hover:text-white"
            >
              Open saved draft
            </Link>
          )}
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
            <div>
              <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                Campaign currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white"
              >
                {fundedCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="text-ink-500 text-xs mt-1">
                Campaigns activate and spend in their own currency — pick a funded deposit balance.
              </p>
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
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                  Bid amount ({currency})
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
                  Total budget ({currency})
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
                    <option key={c} value={c}>
                      {c.replace('_', ' ')}
                    </option>
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
