import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CreateFeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

function makeService() {
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  return { audit, service: new FeedbackService(audit as unknown as AuditService) };
}

describe('FeedbackService', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('accepts a valid message and records an audit event', async () => {
    const res = await ctx.service.submitFeedback(
      { message: 'Love the product!' } as CreateFeedbackDto,
      { ip: '1.2.3.4', userId: null },
    );
    expect(res).toEqual({ received: true });
    expect(ctx.audit.log).toHaveBeenCalledOnce();
  });

  it('rejects honeypot-filled submissions as spam', async () => {
    await expect(
      ctx.service.submitFeedback(
        { message: 'buy cheap things', company: 'spam-inc' } as CreateFeedbackDto,
        { ip: '1.2.3.4' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });

  it('rejects out-of-range ratings', async () => {
    await expect(
      ctx.service.submitFeedback({ message: 'great', rating: 9 } as CreateFeedbackDto, {
        ip: '1.2.3.4',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects empty messages', async () => {
    await expect(
      ctx.service.submitFeedback({ message: '  ' } as CreateFeedbackDto, { ip: '1.2.3.4' }),
    ).rejects.toThrow(BadRequestException);
  });
});
