import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  AdminDevicesQueryDto,
  AuditLogQueryDto,
  FraudFlagsQueryDto,
  IssueDeviceRecoveryTokenDto,
  RecoveryDebtCasesQueryDto,
  WebhookEventsQueryDto,
} from '../../admin/dto/admin.dto';
import { UpdateCampaignDto } from '../../advertiser/dto/advertiser.dto';
import { EarningsQueryDto, UpdateSettingsDto } from '../../developer/dto/developer.dto';
import { CreateFeedbackDto } from '../../feedback/dto/feedback.dto';
import { LedgerHistoryQueryDto } from '../../ledger/dto/ledger.dto';
import { PayoutHistoryQueryDto } from '../../payout/dto/payout.dto';

describe('Non-monetary @IsInt validation', () => {
  describe('UpdateSettingsDto.maxAdsPerHour', () => {
    it('accepts valid values', async () => {
      const dto = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 5 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts boundary values 1 and 12', async () => {
      const low = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 1 });
      const high = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 12 });
      expect(await validate(low)).toHaveLength(0);
      expect(await validate(high)).toHaveLength(0);
    });

    it('rejects values below 1', async () => {
      const dto = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'maxAdsPerHour')).toBe(true);
    });

    it('rejects values above 12', async () => {
      const dto = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 13 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'maxAdsPerHour')).toBe(true);
    });

    it('rejects non-integers', async () => {
      const dto = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 5.5 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'maxAdsPerHour')).toBe(true);
    });

    it('rejects string values that are not numbers', async () => {
      const dto = plainToInstance(UpdateSettingsDto, { maxAdsPerHour: 'five' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'maxAdsPerHour')).toBe(true);
    });
  });

  describe('EarningsQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(EarningsQueryDto, { page: 2, limit: 50 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts string numbers coerced by @Type', async () => {
      const dto = plainToInstance(EarningsQueryDto, { page: '2', limit: '50' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(EarningsQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(EarningsQueryDto, { limit: 101 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });

    it('accepts omitted optional pagination', async () => {
      const dto = plainToInstance(EarningsQueryDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('PayoutHistoryQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(PayoutHistoryQueryDto, { page: 1, limit: 25 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(PayoutHistoryQueryDto, { page: -1 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(PayoutHistoryQueryDto, { limit: 200 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('LedgerHistoryQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(LedgerHistoryQueryDto, { page: 1, limit: 100 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(LedgerHistoryQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(LedgerHistoryQueryDto, { limit: 101 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('FraudFlagsQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(FraudFlagsQueryDto, { page: 1, limit: 200 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(FraudFlagsQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 200', async () => {
      const dto = plainToInstance(FraudFlagsQueryDto, { limit: 201 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('IssueDeviceRecoveryTokenDto.expiresInMinutes', () => {
    it('accepts valid values', async () => {
      const dto = plainToInstance(IssueDeviceRecoveryTokenDto, {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        expiresInMinutes: 30,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts boundary values 5 and 60', async () => {
      const low = plainToInstance(IssueDeviceRecoveryTokenDto, {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        expiresInMinutes: 5,
      });
      const high = plainToInstance(IssueDeviceRecoveryTokenDto, {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        expiresInMinutes: 60,
      });
      expect(await validate(low)).toHaveLength(0);
      expect(await validate(high)).toHaveLength(0);
    });

    it('rejects values below 5', async () => {
      const dto = plainToInstance(IssueDeviceRecoveryTokenDto, {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        expiresInMinutes: 4,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'expiresInMinutes')).toBe(true);
    });

    it('rejects values above 60', async () => {
      const dto = plainToInstance(IssueDeviceRecoveryTokenDto, {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        expiresInMinutes: 61,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'expiresInMinutes')).toBe(true);
    });
  });

  describe('AdminDevicesQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(AdminDevicesQueryDto, { page: 1, limit: 50 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(AdminDevicesQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(AdminDevicesQueryDto, { limit: 101 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('RecoveryDebtCasesQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(RecoveryDebtCasesQueryDto, { page: 1, limit: 50 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(RecoveryDebtCasesQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(RecoveryDebtCasesQueryDto, { limit: 101 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('WebhookEventsQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(WebhookEventsQueryDto, { page: 1, limit: 50 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(WebhookEventsQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(WebhookEventsQueryDto, { limit: 101 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('AuditLogQueryDto pagination', () => {
    it('accepts valid page and limit', async () => {
      const dto = plainToInstance(AuditLogQueryDto, { page: 1, limit: 50 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects page below 1', async () => {
      const dto = plainToInstance(AuditLogQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('rejects limit above 100', async () => {
      const dto = plainToInstance(AuditLogQueryDto, { limit: 101 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  describe('UpdateCampaignDto frequency caps', () => {
    it('accepts valid frequency caps', async () => {
      const dto = plainToInstance(UpdateCampaignDto, {
        frequencyCapPerHour: 10,
        frequencyCapPerDay: 50,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts boundary values', async () => {
      const hourLow = plainToInstance(UpdateCampaignDto, { frequencyCapPerHour: 1 });
      const hourHigh = plainToInstance(UpdateCampaignDto, { frequencyCapPerHour: 30 });
      const dayLow = plainToInstance(UpdateCampaignDto, { frequencyCapPerDay: 1 });
      const dayHigh = plainToInstance(UpdateCampaignDto, { frequencyCapPerDay: 100 });
      expect(await validate(hourLow)).toHaveLength(0);
      expect(await validate(hourHigh)).toHaveLength(0);
      expect(await validate(dayLow)).toHaveLength(0);
      expect(await validate(dayHigh)).toHaveLength(0);
    });

    it('rejects frequencyCapPerHour below 1 and above 30', async () => {
      const low = plainToInstance(UpdateCampaignDto, { frequencyCapPerHour: 0 });
      const high = plainToInstance(UpdateCampaignDto, { frequencyCapPerHour: 31 });
      expect((await validate(low)).some((e) => e.property === 'frequencyCapPerHour')).toBe(true);
      expect((await validate(high)).some((e) => e.property === 'frequencyCapPerHour')).toBe(true);
    });

    it('rejects frequencyCapPerDay below 1 and above 100', async () => {
      const low = plainToInstance(UpdateCampaignDto, { frequencyCapPerDay: 0 });
      const high = plainToInstance(UpdateCampaignDto, { frequencyCapPerDay: 101 });
      expect((await validate(low)).some((e) => e.property === 'frequencyCapPerDay')).toBe(true);
      expect((await validate(high)).some((e) => e.property === 'frequencyCapPerDay')).toBe(true);
    });
  });

  describe('CreateFeedbackDto.rating', () => {
    it('accepts integer ratings', async () => {
      const dto = plainToInstance(CreateFeedbackDto, {
        message: 'Great!',
        rating: 5,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects non-integer ratings', async () => {
      const dto = plainToInstance(CreateFeedbackDto, {
        message: 'Great!',
        rating: 4.5,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'rating')).toBe(true);
    });

    it('accepts omitted optional rating', async () => {
      const dto = plainToInstance(CreateFeedbackDto, { message: 'Great!' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
