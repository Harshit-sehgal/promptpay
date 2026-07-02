import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ApiKeyService } from '../../developer/api-key.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    if (!apiKeyHeader) {
      return false;
    }

    try {
      const apiKey = await this.apiKeyService.validateApiKey(apiKeyHeader);
      // Attach the resolved API key info to the request for downstream use
      request.apiKey = {
        id: apiKey.id,
        ownerId: apiKey.ownerId,
        advertiserId: apiKey.advertiserId,
        scopes: apiKey.scopes,
      };
      return true;
    } catch {
      return false;
    }
  }
}