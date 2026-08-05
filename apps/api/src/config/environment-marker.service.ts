import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '@waitlayer/db';

import { PrismaService } from './prisma.service';

@Injectable()
export class EnvironmentMarkerService {
  private readonly logger = new Logger(EnvironmentMarkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async verify(): Promise<void> {
    const environmentKind = this.config.get<string>('WAITLAYER_ENVIRONMENT_KIND', 'development');
    const environmentId = this.config.get<string>('WAITLAYER_ENVIRONMENT_ID', 'local');
    const marker = await this.prisma.environmentMarker.findUnique({ where: { id: 1 } });

    if (!marker) {
      if (environmentKind === 'production') {
        throw new BadRequestException(
          `Database environment marker is missing for production environment ${environmentKind}/${environmentId}`,
        );
      }
      try {
        await this.prisma.environmentMarker.create({
          data: { id: 1, environmentKind, environmentId },
        });
        this.logger.log(
          `Initialized database environment marker: ${environmentKind}/${environmentId}`,
        );
        return;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        const racedMarker = await this.prisma.environmentMarker.findUnique({ where: { id: 1 } });
        if (!racedMarker) throw error;
        if (
          racedMarker.environmentKind !== environmentKind ||
          racedMarker.environmentId !== environmentId
        ) {
          throw new BadRequestException(
            `Database environment marker ${racedMarker.environmentKind}/${racedMarker.environmentId} does not match API ${environmentKind}/${environmentId}`,
          );
        }
        return;
      }
    }

    if (marker.environmentKind !== environmentKind || marker.environmentId !== environmentId) {
      throw new BadRequestException(
        `Database environment marker ${marker.environmentKind}/${marker.environmentId} does not match API ${environmentKind}/${environmentId}`,
      );
    }
  }
}
