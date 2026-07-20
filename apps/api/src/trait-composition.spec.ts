/**
 * Trait-composition contract tests (P1 #19).
 *
 * The god-services (AuthService, LedgerService, AdminService, AdvertiserService,
 * PayoutService, ExtensionService) were decomposed into mixin/trait files plus a
 * thin facade. The facade's top-level code copies every trait prototype method
 * onto the facade prototype via an assign-loop (`Object.defineProperty`), and an
 * `interface XService extends TraitA, TraitB {}` declaration re-establishes the
 * type. Cross-trait `this.<method>(...)` calls therefore resolve on the SAME
 * facade prototype at runtime.
 *
 * These tests prove the decomposition preserved behavior WITHOUT a database:
 *   (a) every trait method is present on the facade prototype as an own function
 *       assigned by the composition (not an inherited Object.prototype method),
 *       and is copied by reference from one of its mixed-in traits;
 *   (b) at runtime a facade method from one trait delegates to a method copied
 *       from a *different* trait (the assign-loop wiring is exercised, not just
 *       observed statically);
 *   (c) the delegated behavior actually runs and produces correct results.
 */
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminService } from './admin/admin.service';
import { AdminCampaignsTrait } from './admin/admin-campaigns.trait';
import { AdminDevicesTrait } from './admin/admin-devices.trait';
import { AdminFraudTrait } from './admin/admin-fraud.trait';
import { AdminIntegrationsTrait } from './admin/admin-integrations.trait';
import { AdminOverviewTrait } from './admin/admin-overview.trait';
import { AdminPayoutsTrait } from './admin/admin-payouts.trait';
import { AdminUsersTrait } from './admin/admin-users.trait';
import { AdvertiserService } from './advertiser/advertiser.service';
import { AdvertiserCampaignTrait } from './advertiser/advertiser-campaign.trait';
import { AdvertiserDashboardTrait } from './advertiser/advertiser-dashboard.trait';
import { AdvertiserProfileTrait } from './advertiser/advertiser-profile.trait';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { AuthCoreTrait } from './auth/auth-core.trait';
import { AuthEmailTrait } from './auth/auth-email.trait';
import { AuthPasswordTrait } from './auth/auth-password.trait';
import { AuthSessionTrait } from './auth/auth-session.trait';
import { AuthTotpTrait } from './auth/auth-totp.trait';
import { PrismaService } from './config/prisma.service';
import { ExtensionService } from './extension/extension.service';
import { ExtensionAdTrait } from './extension/extension-ad.trait';
import { ExtensionDeviceReportTrait } from './extension/extension-device-report.trait';
import { ExtensionWaitTrait } from './extension/extension-wait.trait';
import { LedgerService } from './ledger/ledger.service';
import { LedgerAdminTrait } from './ledger/ledger-admin.trait';
import { LedgerBalanceTrait } from './ledger/ledger-balance.trait';
import { LedgerEarningsTrait } from './ledger/ledger-earnings.trait';
import { LedgerMathTrait } from './ledger/ledger-math.trait';
import { PayoutService } from './payout/payout.service';
import { PayoutMethodTrait } from './payout/payout-method.trait';
import { PayoutRequestTrait } from './payout/payout-request.trait';
import { PayoutSummaryTrait } from './payout/payout-summary.trait';

type Ctor = new (...args: unknown[]) => object;

// Each facade, the traits it mixes in, and one representative public method that
// the decomposition must have preserved (verified to exist in the trait source).
const SERVICES: Array<{
  Service: Ctor;
  traits: Ctor[];
  representative: string;
}> = [
  {
    Service: AuthService,
    traits: [AuthCoreTrait, AuthEmailTrait, AuthPasswordTrait, AuthSessionTrait, AuthTotpTrait],
    representative: 'signUp',
  },
  {
    Service: LedgerService,
    traits: [LedgerMathTrait, LedgerEarningsTrait, LedgerBalanceTrait, LedgerAdminTrait],
    representative: 'getAvailableBalance',
  },
  {
    Service: AdminService,
    traits: [
      AdminOverviewTrait,
      AdminUsersTrait,
      AdminCampaignsTrait,
      AdminPayoutsTrait,
      AdminFraudTrait,
      AdminDevicesTrait,
      AdminIntegrationsTrait,
    ],
    representative: 'getMetrics',
  },
  {
    Service: AdvertiserService,
    traits: [AdvertiserProfileTrait, AdvertiserCampaignTrait, AdvertiserDashboardTrait],
    representative: 'getDashboard',
  },
  {
    Service: PayoutService,
    traits: [PayoutMethodTrait, PayoutSummaryTrait, PayoutRequestTrait],
    representative: 'requestPayout',
  },
  {
    Service: ExtensionService,
    traits: [ExtensionDeviceReportTrait, ExtensionAdTrait, ExtensionWaitTrait],
    representative: 'requestAd',
  },
];

describe('trait composition: facade wiring (static)', () => {
  for (const { Service, traits, representative } of SERVICES) {
    describe(Service.name, () => {
      it('is a defined class (the thin facade exists)', () => {
        expect(typeof Service).toBe('function');
      });

      it('composes every trait method onto the facade prototype', () => {
        const proto = Service.prototype as Record<string, unknown>;
        for (const Trait of traits) {
          for (const name of Object.getOwnPropertyNames(Trait.prototype)) {
            if (name === 'constructor') continue;
            // (a) the method is present and is a function
            expect(typeof proto[name]).toBe('function');
            // (a) it is an OWN property of the facade prototype — i.e. it was
            //     assigned by the composition, not inherited from Object.prototype
            expect(Object.prototype.hasOwnProperty.call(proto, name)).toBe(true);
            // (a) it was copied BY REFERENCE from one of its traits (prove the
            //     assign-loop ran and wired it, not reimplemented)
            const owners = traits.filter((t) =>
              Object.prototype.hasOwnProperty.call(t.prototype, name),
            );
            expect(owners.length).toBeGreaterThan(0);
            expect(
              owners.some((t) => proto[name] === (t.prototype as Record<string, unknown>)[name]),
            ).toBe(true);
          }
        }
      });

      it(`exposes representative method "${representative}" as a composed function`, () => {
        const proto = Service.prototype as Record<string, unknown>;
        expect(typeof proto[representative]).toBe('function');
        // assigned by the composition (own property of the facade prototype)
        expect(Object.prototype.hasOwnProperty.call(proto, representative)).toBe(true);
        // it is NOT a default Object.prototype method (toString/valueOf/…)
        expect(typeof (Object.prototype as Record<string, unknown>)[representative]).toBe(
          'undefined',
        );
      });
    });
  }
});

// groupBy signature used by getAvailableBalance on earningsLedger.
type GroupBy = (args: {
  where?: { userId?: string; status?: unknown; entryType?: 'credit' | 'debit' };
}) => Promise<Array<{ currency: string; _sum: { amountMinor: bigint } }>>;

describe('trait composition: cross-trait delegation at runtime (LedgerService)', () => {
  // LedgerService.getAvailableBalance lives in ledger-balance.trait.ts and calls
  // addGroupedCurrencyTotals(...) and nonNegativeCurrencyTotals(...) which live in
  // ledger-math.trait.ts. Both are copied onto the same LedgerService.prototype by
  // the assign-loop, so a cross-trait `this.<method>()` call must resolve at runtime.
  let prisma: { earningsLedger: { groupBy: Mock<GroupBy> } };
  let ledger: LedgerService;

  beforeEach(() => {
    prisma = { earningsLedger: { groupBy: vi.fn<GroupBy>() } };
    // LedgerService only stores `audit` as a public field; getAvailableBalance is
    // DB-only and never touches it, so a structure-compatible object satisfies the
    // constructor. Cast through unknown: PrismaService/AuditService are heavy
    // class types we intentionally stub here.
    ledger = new LedgerService(prisma as unknown as PrismaService, {} as unknown as AuditService);
  });

  it('delegates getAvailableBalance -> ledger-math helpers (addGroupedCurrencyTotals / nonNegativeCurrencyTotals)', async () => {
    const addSpy = vi.spyOn(ledger, 'addGroupedCurrencyTotals');
    const nonNegSpy = vi.spyOn(ledger, 'nonNegativeCurrencyTotals');

    prisma.earningsLedger.groupBy.mockImplementation((args) => {
      if (args?.where?.entryType === 'credit') {
        return Promise.resolve([
          { currency: 'USD', _sum: { amountMinor: 1000n } },
          { currency: 'EUR', _sum: { amountMinor: 500n } },
        ]);
      }
      return Promise.resolve([{ currency: 'USD', _sum: { amountMinor: 200n } }]);
    });

    const result = await ledger.getAvailableBalance('user-1');

    // (b) delegation wiring: the ledger-balance method invoked the ledger-math
    //     methods via `this` — proving the assign-loop resolved the cross-trait call.
    expect(addSpy).toHaveBeenCalled();
    expect(nonNegSpy).toHaveBeenCalled();

    // (c) behavioral smoke: the delegated math actually ran and produced correct
    //     money totals (credit 1000 USD + 500 EUR, minus 200 USD debit).
    expect(result.byCurrency.USD).toBe(800n);
    expect(result.byCurrency.EUR).toBe(500n);
    // primaryCurrency returns the alphabetically-first positive currency.
    expect(result.currency).toBe('EUR');
    expect(result.amountMinor).toBe(500n);
  });
});
