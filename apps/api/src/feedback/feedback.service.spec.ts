import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CreateFeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

function makeService() {
  const auditLog = vi.fn().mockResolvedValue(undefined);
  const audit = { log: auditLog, logStrict: auditLog } as unknown as AuditService;
  const service = new FeedbackService(audit);
  return { service, auditLog };
}

describe('FeedbackService (A-078)', () => {
  it('persists the readable message body in the audit afterSnap', async () => {
    const { service, auditLog } = makeService();
    const dto: CreateFeedbackDto = {
      message: '  The export button is broken on Safari  ',
      rating: 4,
      category: 'bug',
      email: 'A@B.com',
    };

    const res = await service.submitFeedback(dto, {
      ip: '1.2.3.4',
      userAgent: 'x',
      userId: 'u1',
    });

    expect(res.received).toBe(true);
    expect(auditLog).toHaveBeenCalledTimes(1);

    const snap = auditLog.mock.calls[0][0].afterSnap;
    // The actual message body must be retained (trimmed), not just metadata.
    expect(snap.message).toBe('The export button is broken on Safari');
    expect(snap.contactEmail).toBe('a@b.com');
    expect(snap.hasEmail).toBe(true);
    expect(snap.length).toBe(dto.message.trim().length);
  });

  it('rejects too-short messages', async () => {
    const { service } = makeService();
    await expect(
      service.submitFeedback({ message: 'hi' } as CreateFeedbackDto, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats a missing email as no contact without error', async () => {
    const { service, auditLog } = makeService();
    const dto: CreateFeedbackDto = { message: 'Reasonable feedback text here', rating: 5 };
    await service.submitFeedback(dto, { userId: 'u2' });
    const snap = auditLog.mock.calls[0][0].afterSnap;
    expect(snap.contactEmail).toBeNull();
    expect(snap.hasEmail).toBe(false);
  });

  it('flags honeypot submissions as spam', async () => {
    const { service } = makeService();
    await expect(
      service.submitFeedback(
        { message: 'legit-looking message body', company: 'bot' } as CreateFeedbackDto,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
