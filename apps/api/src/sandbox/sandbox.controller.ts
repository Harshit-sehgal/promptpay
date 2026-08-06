import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { AdminMfaStepUpGuard } from '../common/guards/admin-mfa-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  SandboxDepositDto,
  SandboxFaucetDto,
  SandboxPayoutDto,
  SandboxResetDto,
} from './sandbox.dto';
import { SandboxService } from './sandbox.service';

@ApiTags('Sandbox')
@Controller('sandbox')
@UseGuards(JwtAuthGuard, RolesGuard, RejectApiKeyGuard)
@Roles('developer', 'advertiser')
export class SandboxController {
  constructor(private readonly service: SandboxService) {}

  @ApiOperation({ summary: 'Get isolated XTS test-credit balance' })
  @Roles('developer')
  @Get('credits')
  credits(@CurrentUser('id') userId: string) {
    return this.service.getCredits(userId);
  }

  @ApiOperation({ summary: 'Claim a fixed, idempotent sandbox faucet grant' })
  @Roles('developer')
  @Post('faucet')
  faucet(@CurrentUser('id') userId: string, @Body() dto: SandboxFaucetDto) {
    return this.service.claimFaucet(userId, dto.idempotencyKey);
  }

  @ApiOperation({ summary: 'Create a deterministic, non-cash sandbox payout simulation' })
  @Roles('developer')
  @Post('payouts')
  payout(@CurrentUser('id') userId: string, @Body() dto: SandboxPayoutDto) {
    return this.service.simulatePayout(userId, dto);
  }

  @ApiOperation({ summary: 'List isolated sandbox payout simulations' })
  @Roles('developer')
  @Get('payouts')
  payouts(@CurrentUser('id') userId: string) {
    return this.service.listPayouts(userId);
  }

  @ApiOperation({ summary: 'Create a deterministic, non-cash sandbox deposit simulation' })
  @Roles('advertiser')
  @Post('deposits')
  deposit(@CurrentUser('id') userId: string, @Body() dto: SandboxDepositDto) {
    return this.service.simulateDeposit(userId, dto);
  }

  @ApiOperation({ summary: 'List isolated sandbox deposit simulations' })
  @Roles('advertiser')
  @Get('deposits')
  deposits(@CurrentUser('id') userId: string) {
    return this.service.listDeposits(userId);
  }

  @ApiOperation({ summary: 'Reconcile isolated sandbox XTS credits' })
  @Roles('admin', 'super_admin')
  @UseGuards(AdminMfaStepUpGuard)
  @Get('admin/reconciliation')
  reconciliation() {
    return this.service.reconcile();
  }

  @ApiOperation({ summary: 'Reset the current isolated sandbox environment' })
  @Roles('admin', 'super_admin')
  @UseGuards(AdminMfaStepUpGuard)
  @Post('admin/reset')
  reset(
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: SandboxResetDto,
  ) {
    return this.service.reset(dto.environmentId, dto.resetToken, { actorId, actorRole });
  }
}
