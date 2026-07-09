'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi, campaignApi } from '@/lib/api/services';

import {
  FREQUENCY_CAPS,
  frequencyCapValueToInput,
  parseFrequencyCapInput,
} from '../../frequency-caps';

interface LoadedCampaign {
  id: string;
  name: string;
  status: string;
  bidType: string;
  bidAmountMinor: number;
  budgetTotalMinor: number;
  currency: string;
  category?: string;
  rejectionReason?: string | null;
  frequencyCapPerHour?: number;
  frequencyCapPerDay?: number;
}

export default function EditCampaignPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Campaign basics (editable subset supported by UpdateCampaignDto)
  const [name, setName] = useState('');
  const [bidType, setBidType] = useState<string>('cpm');
  const [bidAmount, setBidAmount] = useState('2.00');
  const [budgetTotal, setBudgetTotal] = useState('100.00');
  const [currency, setCurrency] = useState('USD');
  const [fundedCurrencies, setFundedCurrencies] = useState<string[]>(['USD']);
  const [category, setCategory] = useState<string>('developer_tools');
  const [status, setStatus] = useState<string>('draft');
  const [campaignRejectionReason, setCampaignRejectionReason] = useState<string | null>(null);
  const [freqCapPerHour, setFreqCapPerHour] = useState('');
  const [freqCapPerDay, setFreqCapPerDay] = useState('');

  // Creative (first creative prefilled when present)
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [ctaText, setCtaText] = useState('Learn more');
  const [ctaUrl, setCtaUrl] = useState('');
  const [creativeRejectionReason, setCreativeRejectionReason] = useState<string | null>(null);

  // Targeting (optional; only sent when the advertiser changes it)
  const [targetCountries, setTargetCountries] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        let found: LoadedCampaign;
        try {
          const res = await advertiserApi.getCampaign(campaignId);
          found = res.data as LoadedCampaign;
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 404) {
            setNotFound(true);
          } else {
            setError(getErrorMessage(err, 'Failed to load campaign'));
          }
          return;
        }
        setStatus(found.status);
        setCampaignRejectionReason(found.rejectionReason ?? null);
        setName(found.name);
        setBidType(found.bidType);
        setBidAmount((found.bidAmountMinor / 100).toFixed(2));
        setBudgetTotal((found.budgetTotalMinor / 100).toFixed(2));
        setCurrency(found.currency);
        if (found.category) setCategory(found.category);

        // A-081: derive selectable currencies — funded deposit balances plus
        // the current currency and USD — so a non-USD deposit is spendable.
        try {
          const billingRes = await advertiserApi.getBilling();
          const balances = (billingRes.data?.balances ?? []) as Array<{
            currency: string;
            balanceMinor: number;
          }>;
          const funded = balances
            .filter((b) => (b.balanceMinor ?? 0) > 0)
            .map((b) => b.currency.toUpperCase());
          setFundedCurrencies(
            Array.from(new Set(['USD', found.currency.toUpperCase(), ...funded].filter(Boolean))),
          );
        } catch {
          setFundedCurrencies(Array.from(new Set(['USD', found.currency.toUpperCase()])));
        }
        setFreqCapPerHour(frequencyCapValueToInput(found.frequencyCapPerHour));
        setFreqCapPerDay(frequencyCapValueToInput(found.frequencyCapPerDay));

        try {
          const creativesRes = await campaignApi.getCreatives(campaignId);
          const creatives = (creativesRes.data ?? []) as Array<{
            id: string;
            title: string;
            sponsoredMessage: string;
            destinationUrl: string;
            ctaText?: string | null;
            rejectionReason?: string | null;
          }>;
          const creative = creatives[0];
          if (creative) {
            setCreativeId(creative.id);
            setHeadline(creative.title);
            setMessage(creative.sponsoredMessage);
            setCtaUrl(creative.destinationUrl);
            setCtaText(creative.ctaText || 'Learn more');
            setCreativeRejectionReason(creative.rejectionReason ?? null);
          }
        } catch {
          // Creative is optional to prefill; the user can still submit one.
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to load campaign'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [campaignId]);

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
    const hourCap = parseFrequencyCapInput(freqCapPerHour, FREQUENCY_CAPS.perHour);
    if (hourCap.error) {
      setError(hourCap.error);
      setSubmitting(false);
      return;
    }
    const dayCap = parseFrequencyCapInput(freqCapPerDay, FREQUENCY_CAPS.perDay);
    if (dayCap.error) {
      setError(dayCap.error);
      setSubmitting(false);
      return;
    }

    try {
      // A-021: a rejected campaign must be reset to draft before it can be
      // edited and resubmitted.
      if (status === 'rejected') {
        await advertiserApi.resetCampaign(campaignId);
      }

      const updatePayload: Record<string, unknown> = {
        name,
        bidAmountMinor,
        budgetTotalMinor,
      };
      if (hourCap.value !== undefined) updatePayload.frequencyCapPerHour = hourCap.value;
      if (dayCap.value !== undefined) updatePayload.frequencyCapPerDay = dayCap.value;
      await advertiserApi.updateCampaign(campaignId, updatePayload);

      const finalCtaUrl = ctaUrl;
      let displayDomain = 'example.com';
      try {
        const urlObj = new URL(finalCtaUrl);
        displayDomain = urlObj.hostname;
      } catch {
        // fallback
      }

      if (creativeId) {
        await campaignApi.updateCreative(creativeId, {
          title: headline,
          sponsoredMessage: message,
          destinationUrl: finalCtaUrl,
          displayDomain,
          ctaText: ctaText?.trim() || undefined,
        });
      } else {
        await campaignApi.createCreative(campaignId, {
          title: headline,
          sponsoredMessage: message,
          destinationUrl: finalCtaUrl,
          displayDomain,
          ctaText: ctaText?.trim() || undefined,
        });
      }

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

      await advertiserApi.submitCampaign(campaignId);

      setSuccess(true);
      setTimeout(() => router.push('/advertiser/campaigns'), 1500);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update campaign'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-ink-900 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-ink-300">Campaign not found.</p>
        <Link href="/advertiser/campaigns" className="text-brand-500 hover:text-brand-400 text-sm">
          ← Back to campaigns
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/advertiser/campaigns" className="text-brand-500 hover:text-brand-400 text-sm">
          ← Back to campaigns
        </Link>
        <div className="mt-6 mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Edit campaign</h1>
          <p className="text-ink-300 text-sm">
            {status === 'rejected'
              ? 'This campaign was rejected. Updating it will reset to draft and resubmit for review.'
              : 'Update your campaign details and resubmit for review.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 mb-6">
            <p className="text-emerald-400 text-sm">Campaign updated and submitted for review!</p>
          </div>
        )}
        {status === 'rejected' && (campaignRejectionReason || creativeRejectionReason) && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-6">
            <p className="text-amber-300 text-sm font-medium mb-2">Rejection reason</p>
            {campaignRejectionReason && (
              <p className="text-amber-100 text-sm">Campaign: {campaignRejectionReason}</p>
            )}
            {creativeRejectionReason && (
              <p className="text-amber-100 text-sm">Creative: {creativeRejectionReason}</p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Campaign details */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Campaign details</h2>
            <div className="space-y-4">
              <div>
                <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                  Campaign name
                </label>
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
              {status === 'draft' && (
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                    Campaign currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand-500"
                  >
                    {fundedCurrencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p className="text-ink-500 text-xs mt-1">
                    Must match a funded deposit balance — campaigns activate and spend in their own
                    currency.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">Bid type</label>
                  <input
                    value={bidType.toUpperCase()}
                    disabled
                    className="w-full bg-ink-700/50 border border-ink-600/50 rounded-lg px-4 py-3 text-ink-400"
                  />
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
                  <input
                    value={category.replace('_', ' ')}
                    disabled
                    className="w-full bg-ink-700/50 border border-ink-600/50 rounded-lg px-4 py-3 text-ink-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                    Frequency cap / hour
                  </label>
                  <input
                    type="number"
                    min={FREQUENCY_CAPS.perHour.min}
                    max={FREQUENCY_CAPS.perHour.max}
                    step="1"
                    value={freqCapPerHour}
                    onChange={(e) => setFreqCapPerHour(e.target.value)}
                    placeholder="Leave unchanged"
                    inputMode="numeric"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                  <p className="text-ink-500 text-xs mt-1">
                    1-30. Blank leaves the current cap unchanged.
                  </p>
                </div>
                <div>
                  <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                    Frequency cap / day
                  </label>
                  <input
                    type="number"
                    min={FREQUENCY_CAPS.perDay.min}
                    max={FREQUENCY_CAPS.perDay.max}
                    step="1"
                    value={freqCapPerDay}
                    onChange={(e) => setFreqCapPerDay(e.target.value)}
                    placeholder="Leave unchanged"
                    inputMode="numeric"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                  <p className="text-ink-500 text-xs mt-1">
                    1-100. Blank leaves the current cap unchanged.
                  </p>
                </div>
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
                    placeholder="https://your-product.com"
                    className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

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
                placeholder="US, GB, DE (leave empty to keep current targeting)"
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
              />
              <p className="text-ink-500 text-xs mt-1">
                Empty = leave current targeting unchanged. Use 2-letter ISO codes (US, GB, DE, IN,
                etc.)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              {submitting
                ? 'Saving...'
                : status === 'rejected'
                  ? 'Update & resubmit'
                  : 'Save & submit'}
            </button>
            {submitting && <LoadingSpinner size="sm" />}
          </div>
        </form>
      </div>
    </div>
  );
}
