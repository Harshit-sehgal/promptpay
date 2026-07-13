import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@ApiTags('API Keys')
@Controller('developer/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class ApiKeyController {
  constructor(private service: ApiKeyService) {}

  @ApiOperation({ summary: 'Generate API key' })
  @Post()
  generateApiKey(@CurrentUser('id') userId: string, @Body() dto: CreateApiKeyDto) {
    return this.service.generateApiKey(userId, dto.scopes, dto.advertiserId, dto.expiresAt);
  }

  @ApiOperation({ summary: 'List API keys' })
  @Get()
  listApiKeys(@CurrentUser('id') userId: string) {
    return this.service.listApiKeys(userId);
  }

  @ApiOperation({ summary: 'Revoke API key' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  revokeApiKey(@Param('id', ParseUUIDPipe) keyId: string, @CurrentUser('id') userId: string) {
    return this.service.revokeApiKey(keyId, userId);
  }
}
