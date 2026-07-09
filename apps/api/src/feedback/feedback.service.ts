import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CreateFeedbackDto } from './dto/feedback.dto';

/**
 * Product feedback ingestion.
 *
 * Feedback was previously stored only in the browser's localStorage, so user
 * messages never reached the team. This service makes the submission durable
 * and auditable: valid submissions are recorded via the audit log (which ops
 * can search), and obvious spam/bot submissions are rejected. It deliberately
 * does NOT require authentication — logged-out visitors must be able to report
 * issues.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private audit: AuditService) {}

  async submitFeedback(
    dto: CreateFeedbackDto,
    meta: { ip?: string; userAgent?: string; userId?: string | null },
  ) {
    // Honeypot: a filled `company` field means an automated submitter.
    if (dto.company && dto.company.trim().length > 0) {
      throw new BadRequestException('Spam detected');
    }

    if (dto.rating !== undefined && (dto.rating < 1 || dto.rating > 5)) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const text = dto.message.trim();
    if (text.length < 3) {
      throw new BadRequestException('Feedback message is too short');
    }
    const contactEmail = dto.email?.trim().toLowerCase() || null;

    await this.audit.log({
      actorId: meta.userId ?? 'anonymous',
      actorRole: meta.userId ? 'developer' : 'anonymous',
      action: 'feedback_submitted',
      targetType: 'feedback',
      targetId: 'feedback',
      afterSnap: {
        category: dto.category ?? 'other',
        rating: dto.rating,
        message: text,
        contactEmail,
        hasEmail: Boolean(contactEmail),
        length: text.length,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    this.logger.log(
      `Feedback received (category=${dto.category ?? 'other'}, rating=${dto.rating ?? '-'}, contact=${contactEmail ?? 'none'})`,
    );

    return { received: true };
  }
}
