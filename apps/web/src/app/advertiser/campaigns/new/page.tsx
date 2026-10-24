'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { ActionLink, Notice, PageHeader, Panel, PanelHeader } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi, campaignApi } from '@/lib/api/services';

import { campaignMinimumBudgetMinor } from '@ateva/shared';

import { campaignMoneyInputPolicy, parseCampaignAmountMinor } from '../campaign-money';

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
  const moneyPolicy = campaignMoneyInputPolicy(currency);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDraftRecoveryId(null);
    setSubmitting(true);

    const bidAmountMinor = parseCampaignAmountMinor(bidAmount, currency);
    const budgetTotalMinor = parseCampaignAmountMinor(budgetTotal, currency);
    if (bidAmountMinor === null || bidAmountMinor <= 0n) {
      setError('Enter a valid bid amount');
      setSubmitting(false);
      return;
    }
    if (budgetTotalMinor === null || budgetTotalMinor < campaignMinimumBudgetMinor(currency)) {
      setError(`Minimum budget is ${moneyPolicy.minimumBudgetLabel}`);
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
      <PageHeader
        eyebrow="Advertiser"
        title="Create campaign"
        lede="Set up your ad campaign, creative, and targeting in one step"
      />

      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            draftRecoveryId ? (
              <ActionLink href={`/advertiser/campaigns/${draftRecoveryId}/edit`} variant="text">
                Open saved draft
              </ActionLink>
            ) : undefined
          }
        >
          {error}
        </Notice>
      )}
      {success && <Notice tone="ok">Campaign created and submitted for review!</Notice>}

      <form onSubmit={handleSubmit} className="grid max-w-3xl gap-5">
        {/* Campaign details */}
        <Panel>
          <PanelHeader title="Campaign details" />
          <div className="space-y-4">
            <div>
              <label htmlFor="campaign-name" className="mb-1.5 block">
                Campaign name
              </label>
              <input
                id="campaign-name"
                data-testid="campaign-name-input"
                aria-label="Campaign name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="My developer tool campaign"
                autoComplete="off"
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="campaign-currency" className="mb-1.5 block">
                Campaign currency
              </label>
              <select
                id="campaign-currency"
                data-testid="campaign-currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full"
              >
                {fundedCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Campaigns activate and spend in their own currency — pick a funded deposit balance.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="campaign-bid-type" className="mb-1.5 block">
                  Bid type
                </label>
                <select
                  id="campaign-bid-type"
                  data-testid="campaign-bid-type-select"
                  aria-label="Bid type"
                  value={bidType}
                  onChange={(e) => setBidType(e.target.value)}
                  className="w-full"
                >
                  {BID_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="campaign-bid-amount" className="mb-1.5 block">
                  Bid amount ({currency})
                </label>
                <input
                  id="campaign-bid-amount"
                  data-testid="campaign-bid-amount-input"
                  aria-label={`Bid amount (${currency})`}
                  type="number"
                  step={moneyPolicy.minorUnitStep}
                  min={moneyPolicy.minimumBid}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  required
                  inputMode="decimal"
                  className="w-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="campaign-budget" className="mb-1.5 block">
                  Total budget ({currency})
                </label>
                <input
                  id="campaign-budget"
                  data-testid="campaign-budget-input"
                  aria-label={`Total budget (${currency})`}
                  type="number"
                  step={moneyPolicy.minorUnitStep}
                  min={moneyPolicy.minimumBudget}
                  max={moneyPolicy.maximumBudget}
                  value={budgetTotal}
                  onChange={(e) => setBudgetTotal(e.target.value)}
                  required
                  inputMode="decimal"
                  className="w-full"
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {moneyPolicy.minimumBudgetLabel} – {moneyPolicy.maximumBudgetLabel}
                </p>
              </div>
              <div>
                <label htmlFor="campaign-category" className="mb-1.5 block">
                  Category
                </label>
                <select
                  id="campaign-category"
                  data-testid="campaign-category-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full"
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
              <label htmlFor="campaign-landing-url" className="mb-1.5 block">
                Landing URL
              </label>
              <input
                id="campaign-landing-url"
                data-testid="campaign-landing-url-input"
                type="url"
                value={landingUrl}
                onChange={(e) => setLandingUrl(e.target.value)}
                required
                placeholder="https://your-product.com"
                autoComplete="url"
                inputMode="url"
                className="w-full"
              />
            </div>
          </div>
        </Panel>

        {/* Ad creative */}
        <Panel>
          <PanelHeader title="Ad creative" />
          <div className="space-y-4">
            <div>
              <label htmlFor="campaign-headline" className="mb-1.5 block">
                Headline
              </label>{' '}
              <input
                id="campaign-headline"
                data-testid="campaign-headline-input"
                aria-label="Headline"
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                required
                maxLength={50}
                placeholder="Short, attention-grabbing headline"
                className="w-full"
              />
              <p className="mt-1 text-xs text-[var(--muted)]">{headline.length}/50 characters</p>
            </div>

            <div>
              <label htmlFor="campaign-message" className="mb-1.5 block">
                Message
              </label>{' '}
              <textarea
                id="campaign-message"
                data-testid="campaign-message-input"
                aria-label="Message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength={80}
                rows={2}
                placeholder="Max 80 chars — shown during wait states"
                className="w-full"
              />
              <p className="mt-1 text-xs text-[var(--muted)]">{message.length}/80 characters</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="campaign-cta-text" className="mb-1.5 block">
                  CTA text
                </label>
                <input
                  id="campaign-cta-text"
                  data-testid="campaign-cta-text-input"
                  type="text"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  required
                  maxLength={25}
                  placeholder="Learn more"
                  className="w-full"
                />
              </div>
              <div>
                <label htmlFor="campaign-cta-url" className="mb-1.5 block">
                  CTA URL
                </label>
                <input
                  id="campaign-cta-url"
                  data-testid="campaign-cta-url-input"
                  type="url"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="Defaults to landing URL"
                  className="w-full"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="rounded-xl border border-[var(--hair)] bg-[var(--glass-strong)] p-4">
              <p className="dash-eyebrow mb-2">Preview</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--ink)]">{headline || 'Headline'}</p>
                  <p className="text-sm text-[var(--copy)]">{message || 'Ad message text'}</p>
                </div>
                <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--on-ink)]">
                  {ctaText || 'Learn more'}
                </span>
              </div>
            </div>
          </div>
        </Panel>

        {/* Targeting */}
        <Panel>
          <PanelHeader title="Targeting" />
          <div>
            <label htmlFor="campaign-target-countries" className="mb-1.5 block">
              Country targeting (comma-separated ISO codes)
            </label>
            <input
              id="campaign-target-countries"
              data-testid="campaign-target-countries-input"
              aria-label="Country targeting (comma-separated ISO codes)"
              type="text"
              value={targetCountries}
              onChange={(e) => setTargetCountries(e.target.value)}
              placeholder="US, GB, DE (leave empty for all)"
              className="w-full"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              Empty = worldwide. Use 2-letter ISO codes (US, GB, DE, IN, etc.)
            </p>
          </div>
        </Panel>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="dash-btn dash-btn--primary dash-btn--lg"
          >
            {submitting ? 'Creating...' : 'Create & submit campaign'}
          </button>
          {submitting && <LoadingSpinner size="sm" />}
        </div>
      </form>
    </>
  );
}
