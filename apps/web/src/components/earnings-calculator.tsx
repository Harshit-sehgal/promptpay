'use client';

import { useState } from 'react';

type Mode = 'developer' | 'advertiser';

/**
 * Homepage value-proposition calculator.
 *
 * Lets a visitor model earnings (developer mode) or campaign reach (advertiser
 * mode) from a few sliders. The slider accessible names are fixed and consumed
 * by the a11y E2E (`/ has no serious or critical WCAG 2.1 AA violations` and the
 * "homepage calculator sliders have accessible names in both modes" test), so
 * they must not change without updating that test.
 */
export function EarningsCalculator() {
  const [mode, setMode] = useState<Mode>('developer');

  const [dailyQueries, setDailyQueries] = useState(40);
  const [adFrequency, setAdFrequency] = useState(6);
  const [avgCpm, setAvgCpm] = useState(4);

  const [campaignBudget, setCampaignBudget] = useState(2000);
  const [targetCpm, setTargetCpm] = useState(4);
  const [ctr, setCtr] = useState(2);

  const toggle = () => setMode((m) => (m === 'developer' ? 'advertiser' : 'developer'));

  const developerEarnings = (dailyQueries * adFrequency * avgCpm) / 1000;
  const advertiserImpressions = Math.round((campaignBudget / targetCpm) * 1000);
  const advertiserClicks = Math.round((advertiserImpressions * ctr) / 100);

  return (
    <section
      aria-label="Earnings calculator"
      style={{
        maxWidth: '1180px',
        margin: '56px auto 0',
        padding: '28px 32px',
        border: '1px solid #e6e6e6',
        borderRadius: '16px',
        background: '#fff',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '20px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '18px', color: '#0a0a0a' }}>
          Model your {mode === 'developer' ? 'earnings' : 'campaign reach'}
        </h3>
        <button
          type="button"
          onClick={toggle}
          style={{
            border: '1px solid #d8d8d8',
            borderRadius: '10px',
            padding: '8px 14px',
            fontSize: '14px',
            cursor: 'pointer',
            background: '#fafafa',
            color: '#0a0a0a',
          }}
        >
          {mode === 'developer' ? 'For Advertisers' : 'For Developers'}
        </button>
      </div>

      {mode === 'developer' ? (
        <div style={{ display: 'grid', gap: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#444' }}>
            Daily AI Queries: {dailyQueries}
            <input
              type="range"
              aria-label="Daily AI Queries"
              min={1}
              max={500}
              value={dailyQueries}
              onChange={(e) => setDailyQueries(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '14px', color: '#444' }}>
            Ad Display Frequency: {adFrequency}
            <input
              type="range"
              aria-label="Ad Display Frequency"
              min={1}
              max={20}
              value={adFrequency}
              onChange={(e) => setAdFrequency(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '14px', color: '#444' }}>
            Average Campaign CPM: ${avgCpm}
            <input
              type="range"
              aria-label="Average Campaign CPM"
              min={1}
              max={20}
              value={avgCpm}
              onChange={(e) => setAvgCpm(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
          <p style={{ margin: '4px 0 0', fontSize: '15px', color: '#0a0a0a' }}>
            Estimated daily earnings: <strong>${developerEarnings.toFixed(2)}</strong>
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          <label style={{ display: 'block', fontSize: '14px', color: '#444' }}>
            Campaign Budget: ${campaignBudget}
            <input
              type="range"
              aria-label="Campaign Budget"
              min={100}
              max={100000}
              step={100}
              value={campaignBudget}
              onChange={(e) => setCampaignBudget(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '14px', color: '#444' }}>
            Target CPM: ${targetCpm}
            <input
              type="range"
              aria-label="Target CPM"
              min={1}
              max={20}
              value={targetCpm}
              onChange={(e) => setTargetCpm(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '14px', color: '#444' }}>
            Expected Click-Through Rate (CTR): {ctr}%
            <input
              type="range"
              aria-label="Expected Click-Through Rate (CTR)"
              min={0.1}
              max={10}
              step={0.1}
              value={ctr}
              onChange={(e) => setCtr(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
          <p style={{ margin: '4px 0 0', fontSize: '15px', color: '#0a0a0a' }}>
            Estimated impressions: <strong>{advertiserImpressions.toLocaleString()}</strong> ·
            clicks: <strong>{advertiserClicks.toLocaleString()}</strong>
          </p>
        </div>
      )}
    </section>
  );
}
