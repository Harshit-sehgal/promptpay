import { Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Controller('developer/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class ApiKeyController {
  constructor(private service: ApiKeyService) {}

  @Post()
  generateApiKey(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.service.generateApiKey(userId, dto.scopes, dto.advertiserId, dto.expiresAt);
  }

  @Get()
  listApiKeys(@CurrentUser('id') userId: string) {
    return this.service.listApiKeys(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  revokeApiKey(
    @Param('id', ParseUUIDPipe) keyId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.revokeApiKey(keyId, userId);
  }
}