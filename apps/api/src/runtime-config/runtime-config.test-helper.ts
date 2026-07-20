import { vi } from 'vitest';

import { RuntimeConfigService } from './runtime-config.service';

/**
 * Returns a typed partial mock of RuntimeConfigService with all public
 * kill-switch helpers returning permissive defaults. Override individual
 * methods by spreading your own mocks over the returned object.
 */
export function createMockRuntimeConfig(
  overrides: Partial<Record<keyof RuntimeConfigService, unknown>> = {},
): RuntimeConfigService {
  const mock = {
    isAdsEnabled: vi.fn().mockResolvedValue(true),
    isDepositsEnabled: vi.fn().mockResolvedValue(true),
    isPayoutRequestsEnabled: vi.fn().mockResolvedValue(true),
    isAutoPayoutProcessingEnabled: vi.fn().mockResolvedValue(true),
    isProviderEnabled: vi.fn().mockResolvedValue(true),
    isToolEnabled: vi.fn().mockResolvedValue(true),
    isCountryAllowed: vi.fn().mockResolvedValue(true),
    isCurrencyAllowed: vi.fn().mockResolvedValue(true),
    isExtensionVersionAllowed: vi.fn().mockResolvedValue(true),
    isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
    getBoolean: vi.fn().mockResolvedValue(true),
    setBoolean: vi.fn().mockResolvedValue({}),
    getStringArray: vi.fn().mockResolvedValue([]),
    setStringArray: vi.fn().mockResolvedValue({}),
    getString: vi.fn().mockResolvedValue(null),
    setString: vi.fn().mockResolvedValue({}),
    getAll: vi.fn().mockResolvedValue([]),
    setRaw: vi.fn().mockResolvedValue({}),
  } as unknown as RuntimeConfigService;

  return { ...mock, ...overrides } as RuntimeConfigService;
}
