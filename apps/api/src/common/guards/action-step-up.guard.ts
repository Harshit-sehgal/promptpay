import { Request } from 'express';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export const STEP_UP_ACTION_KEY = 'stepUpAction';

export interface StepUpTokenPayload {
  sub: string;
  action: string;
  aud: string | string[];
  iss?: string;
  iat?: number;
  exp?: number;
}

export const ActionStepUp = (action: string) => SetMetadata(STEP_UP_ACTION_KEY, action);

interface StepUpRequest extends Request {
  user?: { id?: string; role?: string };
}

/**
 * Require a recent, action-scoped MFA step-up token for sensitive mutations.
 *
 * The client obtains a short-lived token from POST /auth/step-up by proving
 * ownership of the current TOTP (or backup code). The token is then passed in
 * the `x-step-up-token` header for the sensitive action. This binds the MFA
 * proof to a concrete action (e.g., `payout:request`) and a short time window,
 * preventing replay across actions or after a brief expiry.
 */
@Injectable()
export class ActionStepUpGuard implements CanActivate {
  private readonly jwt: JwtService;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly publicKey: string;

  constructor(config: ConfigService) {
    this.issuer = config.get<string>('JWT_ISSUER', 'waitlayer');
    this.audience = config.get<string>('JWT_AUDIENCE', 'waitlayer-client');
    const publicKey = config.get<string>('JWT_PUBLIC_KEY');
    if (!publicKey) {
      throw new Error('JWT_PUBLIC_KEY must be defined to verify step-up tokens');
    }
    this.publicKey = publicKey;
    this.jwt = new JwtService({
      publicKey,
      verifyOptions: {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: this.audience,
      },
    });
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<StepUpRequest>();
    const requiredAction = Reflect.getMetadata(STEP_UP_ACTION_KEY, context.getHandler()) as
      string | undefined;
    if (!requiredAction) {
      return true;
    }

    const token =
      (req.headers?.['x-step-up-token'] as string | undefined) ?? req.get?.('x-step-up-token');
    if (!token) {
      throw new ForbiddenException('Step-up authentication is required for this action');
    }

    let payload: StepUpTokenPayload;
    try {
      payload = this.jwt.verify<StepUpTokenPayload>(token);
    } catch {
      throw new ForbiddenException('Invalid or expired step-up token');
    }

    const tokenAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!tokenAud.includes('step-up')) {
      throw new ForbiddenException('Invalid step-up token');
    }

    if (payload.sub !== req.user?.id) {
      throw new ForbiddenException('Step-up token does not belong to the current user');
    }
    if (payload.action !== requiredAction) {
      throw new ForbiddenException('Step-up token is not valid for this action');
    }
    return true;
  }
}
