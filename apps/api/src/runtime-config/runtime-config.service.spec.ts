import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { RUNTIME_CONFIG_KEYS, RuntimeConfigService } from './runtime-config.service';

describe('RuntimeConfigService', () => {
  let service: RuntimeConfigService;
  let configService: ConfigService;

  const mockPrisma = {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  };

  const mockAudit = {
    log: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RuntimeConfigService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    service = module.get(RuntimeConfigService);
    configService = module.get<ConfigService>(ConfigService);
    vi.clearAllMocks();
  });

  describe('getBoolean', () => {
    it('returns default true when no row exists', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
      const result = await service.getBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, true);
      expect(result).toBe(true);
    });

    it('returns stored enabled value', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        value: { enabled: false },
      });
      const result = await service.getBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, true);
      expect(result).toBe(false);
    });

    it('caches the value and avoids repeated DB hits', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false } });
      await service.getBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, true);
      await service.getBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, true);
      expect(mockPrisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('isWaitEarningsEnabled', () => {
    it('fails closed until the operator explicitly enables settlement', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

      await expect(service.isWaitEarningsEnabled()).resolves.toBe(false);
      expect(mockPrisma.systemSetting.findUnique).toHaveBeenCalledWith({
        where: { scope_target: { scope: 'wait', target: 'earnings' } },
      });
    });
  });

  describe('getWaitLaunchMode', () => {
    it('reports telemetry_only when advertising is enabled but settlement is fail-closed', async () => {
      mockPrisma.systemSetting.findUnique.mockImplementation(
        ({ where }: { where: { scope_target: { scope: string; target: string } } }) => {
          const { scope, target } = where.scope_target;
          if (scope === 'ads' && target === 'global')
            return Promise.resolve({ value: { enabled: true } });
          if (scope === 'wait' && target === 'earnings') return Promise.resolve(null);
          return Promise.resolve(null);
        },
      );

      await expect(service.getWaitLaunchMode()).resolves.toBe('telemetry_only');
    });

    it('reports paused before earnings state when ads are globally disabled', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false } });

      await expect(service.getWaitLaunchMode()).resolves.toBe('paused');
    });

    it('keeps the public mode telemetry_only when earnings is enabled without an attestation config', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
      vi.mocked(configService.get).mockReturnValue(undefined);

      await expect(service.getWaitLaunchMode()).resolves.toBe('telemetry_only');
    });

    it('reports earnings_enabled only with an issuer and attestation-version allowlist', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
      vi.mocked(configService.get).mockImplementation((key: string) => {
        if (key === 'VERIFIED_WAIT_ATTESTATION_VERSIONS') return 'provider-v1';
        if (key === 'WAIT_ATTESTATION_ISSUERS') {
          return JSON.stringify([
            {
              provider: 'provider',
              issuer: 'https://attestor.example.test',
              audience: 'waitlayer',
              publicKeys: { kid: 'public-key' },
            },
          ]);
        }
        return undefined;
      });

      await expect(service.getWaitLaunchMode()).resolves.toBe('earnings_enabled');
    });
  });

  describe('setBoolean', () => {
    it('upserts the setting and audits the change', async () => {
      mockPrisma.systemSetting.upsert.mockResolvedValue({
        id: '1',
        scope: 'ads',
        target: 'global',
        value: { enabled: false },
      });
      await service.setBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, false, 'admin-1', 'emergency');
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { scope_target: { scope: 'ads', target: 'global' } },
        create: { scope: 'ads', target: 'global', value: { enabled: false } },
        update: { value: { enabled: false }, reason: 'emergency' },
      });
      expect(mockAudit.log).toHaveBeenCalled();
    });
  });

  describe('getStringArray', () => {
    it('returns default empty array when no row exists', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
      const result = await service.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_COUNTRIES, []);
      expect(result).toEqual([]);
    });

    it('returns stored values', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        value: { values: ['US', 'CA'] },
      });
      const result = await service.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_COUNTRIES, []);
      expect(result).toEqual(['US', 'CA']);
    });
  });

  describe('isCountryAllowed', () => {
    it('returns true when country is not blocked', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        value: { values: ['US'] },
      });
      const result = await service.isCountryAllowed('CA');
      expect(result).toBe(true);
    });

    it('returns false when country is blocked', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        value: { values: ['US'] },
      });
      const result = await service.isCountryAllowed('us');
      expect(result).toBe(false);
    });
  });

  describe('isExtensionVersionAllowed', () => {
    it('returns true when no min version is set', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
      const result = await service.isExtensionVersionAllowed('1.2.3');
      expect(result).toBe(true);
    });

    it('returns false when version is below minimum', async () => {
      mockPrisma.systemSetting.findUnique.mockImplementation(
        (args: { where: { scope_target: { scope: string; target: string } } }) => {
          if (args.where.scope_target.target === 'min_version') {
            return Promise.resolve({ value: { value: '2.0.0' } });
          }
          return Promise.resolve({ value: { values: [] } });
        },
      );
      const result = await service.isExtensionVersionAllowed('1.9.9');
      expect(result).toBe(false);
    });

    it('returns true when version meets minimum', async () => {
      mockPrisma.systemSetting.findUnique.mockImplementation(
        (args: { where: { scope_target: { scope: string; target: string } } }) => {
          if (args.where.scope_target.target === 'min_version') {
            return Promise.resolve({ value: { value: '1.0.0' } });
          }
          return Promise.resolve({ value: { values: [] } });
        },
      );
      const result = await service.isExtensionVersionAllowed('1.2.3');
      expect(result).toBe(true);
    });
  });

  describe('getAll', () => {
    it('returns all settings ordered by scope and target', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { scope: 'ads', target: 'global' },
        { scope: 'payouts', target: 'requests' },
      ]);
      const result = await service.getAll();
      expect(result).toHaveLength(2);
      expect(mockPrisma.systemSetting.findMany).toHaveBeenCalledWith({
        orderBy: [{ scope: 'asc' }, { target: 'asc' }],
      });
    });
  });
  describe('isDetectorVersionEnabled', () => {
    it('defaults to true when no config row exists', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
      const result = await service.isDetectorVersionEnabled('1.0.0');
      expect(result).toBe(true);
      expect(mockPrisma.systemSetting.findUnique).toHaveBeenCalledWith({
        where: { scope_target: { scope: 'detector', target: '1.0.0' } },
      });
    });

    it('returns true when the detector version is enabled', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
      const result = await service.isDetectorVersionEnabled('1.0.0');
      expect(result).toBe(true);
    });

    it('returns false when the detector version is disabled', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false } });
      const result = await service.isDetectorVersionEnabled('1.0.0');
      expect(result).toBe(false);
    });

    it('returns true for a null/undefined version without a DB lookup', async () => {
      const result = await service.isDetectorVersionEnabled(undefined);
      expect(result).toBe(true);
      expect(mockPrisma.systemSetting.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getVerifiedDetectorVersions', () => {
    it('returns the validated config value trimmed', () => {
      configService.get = vi.fn().mockReturnValue('  1.0.0,1.1.0  ');
      expect(service.getVerifiedDetectorVersions()).toBe('1.0.0,1.1.0');
    });

    it('returns an empty string when the config key is missing', () => {
      configService.get = vi.fn().mockReturnValue(undefined);
      expect(service.getVerifiedDetectorVersions()).toBe('');
    });
  });
});
