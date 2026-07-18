import { describe, expect, it } from 'vitest';

import { AdminService } from '../../admin/admin.service';
import { AdminCampaignsTrait } from '../../admin/admin-campaigns.trait';
import { AdminDevicesTrait } from '../../admin/admin-devices.trait';
import { AdminFraudTrait } from '../../admin/admin-fraud.trait';
import { AdminIntegrationsTrait } from '../../admin/admin-integrations.trait';
import { AdminOverviewTrait } from '../../admin/admin-overview.trait';
import { AdminPayoutsTrait } from '../../admin/admin-payouts.trait';
import { AdminUsersTrait } from '../../admin/admin-users.trait';
import { AdvertiserService } from '../../advertiser/advertiser.service';
import { AdvertiserCampaignTrait } from '../../advertiser/advertiser-campaign.trait';
import { AdvertiserDashboardTrait } from '../../advertiser/advertiser-dashboard.trait';
import { AdvertiserProfileTrait } from '../../advertiser/advertiser-profile.trait';
import { AuthService } from '../../auth/auth.service';
import { AuthCoreTrait } from '../../auth/auth-core.trait';
import { AuthEmailTrait } from '../../auth/auth-email.trait';
import { AuthPasswordTrait } from '../../auth/auth-password.trait';
import { AuthSessionTrait } from '../../auth/auth-session.trait';
import { AuthTotpTrait } from '../../auth/auth-totp.trait';
import { ExtensionService } from '../../extension/extension.service';
import { ExtensionAdTrait } from '../../extension/extension-ad.trait';
import { ExtensionDeviceReportTrait } from '../../extension/extension-device-report.trait';
import { ExtensionWaitTrait } from '../../extension/extension-wait.trait';
import { LedgerService } from '../../ledger/ledger.service';
import { LedgerAdminTrait } from '../../ledger/ledger-admin.trait';
import { LedgerBalanceTrait } from '../../ledger/ledger-balance.trait';
import { LedgerEarningsTrait } from '../../ledger/ledger-earnings.trait';
import { LedgerMathTrait } from '../../ledger/ledger-math.trait';
import { PayoutService } from '../../payout/payout.service';
import { PayoutMethodTrait } from '../../payout/payout-method.trait';
import { PayoutRequestTrait } from '../../payout/payout-request.trait';
import { PayoutSummaryTrait } from '../../payout/payout-summary.trait';

/**
 * Trait composition tests (P1 #19).
 *
 * The largest NestJS services are decomposed into trait classes and then
 * composed onto a thin facade service by copying prototype methods at module
 * load time. These tests verify that the composition actually happened: every
 * public method declared on a trait is present on the service prototype and
 * points to the original trait implementation.
 */

function getMethodNames(proto: object): string[] {
  return Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' && typeof (proto as Record<string, unknown>)[name] === 'function',
  );
}

function expectTraitMethodsComposed(
  serviceClass: { prototype: object },
  traitClasses: Array<{ prototype: object }>,
): void {
  const serviceProto = serviceClass.prototype;
  const traitMethods = new Map<string, Function>();

  for (const trait of traitClasses) {
    for (const name of getMethodNames(trait.prototype)) {
      // Detect duplicate method names across traits — a collision would mean
      // the last copied trait wins, which is a bug waiting to happen.
      if (traitMethods.has(name)) {
        throw new Error(`Trait method collision: ${name} is defined by multiple traits`);
      }
      traitMethods.set(name, (trait.prototype as Record<string, Function>)[name]);
    }
  }

  for (const [name, traitFn] of traitMethods) {
    const serviceFn = (serviceProto as Record<string, Function>)[name];
    expect(serviceFn).toBeDefined();
    expect(typeof serviceFn).toBe('function');
    // The service prototype should have copied the trait function reference.
    expect(serviceFn).toBe(traitFn);
  }
}

describe('AuthService trait composition', () => {
  it('composes all auth traits', () => {
    expectTraitMethodsComposed(AuthService, [
      AuthCoreTrait,
      AuthEmailTrait,
      AuthTotpTrait,
      AuthPasswordTrait,
      AuthSessionTrait,
    ]);
  });
});

describe('LedgerService trait composition', () => {
  it('composes all ledger traits', () => {
    expectTraitMethodsComposed(LedgerService, [
      LedgerMathTrait,
      LedgerEarningsTrait,
      LedgerBalanceTrait,
      LedgerAdminTrait,
    ]);
  });
});

describe('AdminService trait composition', () => {
  it('composes all admin traits', () => {
    expectTraitMethodsComposed(AdminService, [
      AdminUsersTrait,
      AdminDevicesTrait,
      AdminPayoutsTrait,
      AdminOverviewTrait,
      AdminIntegrationsTrait,
      AdminCampaignsTrait,
      AdminFraudTrait,
    ]);
  });
});

describe('AdvertiserService trait composition', () => {
  it('composes all advertiser traits', () => {
    expectTraitMethodsComposed(AdvertiserService, [
      AdvertiserProfileTrait,
      AdvertiserCampaignTrait,
      AdvertiserDashboardTrait,
    ]);
  });
});

describe('PayoutService trait composition', () => {
  it('composes all payout traits', () => {
    expectTraitMethodsComposed(PayoutService, [
      PayoutRequestTrait,
      PayoutMethodTrait,
      PayoutSummaryTrait,
    ]);
  });
});

describe('ExtensionService trait composition', () => {
  it('composes all extension traits', () => {
    expectTraitMethodsComposed(ExtensionService, [
      ExtensionAdTrait,
      ExtensionDeviceReportTrait,
      ExtensionWaitTrait,
    ]);
  });
});
