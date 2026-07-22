import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { ConsumeWaitAttestationDto, CreateWaitAttestationSessionDto } from './dto';

const SESSION_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const MAX_DURATION_MS = 30 * 60_000;
const DURATION_TOLERANCE_MS = 1_000;

interface IssuerConfig {
  provider: string;
  issuer: string;
  audience: string;
  publicKeys: Record<string, string>;
}

interface AttestationClaims {
  sub?: unknown;
  device_id?: unknown;
  nonce?: unknown;
  session_id?: unknown;
  wait_state_id?: unknown;
  provider?: unknown;
  event_id?: unknown;
  attestation_version?: unknown;
  started_at_ms?: unknown;
  ended_at_ms?: unknown;
  duration_ms?: unknown;
  exp?: unknown;
  nbf?: unknown;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decodeHeader(assertion: string): { alg: string; kid: string } {
  const part = assertion.split('.')[0];
  try {
    const header = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      alg?: unknown;
      kid?: unknown;
    };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new Error('invalid assertion header');
    }
    return { alg: header.alg, kid: header.kid };
  } catch {
    throw new UnauthorizedException('Wait attestation has an invalid signing header');
  }
}

function stringClaim(claim: unknown, name: string, max = 256): string {
  if (typeof claim !== 'string' || claim.length === 0 || claim.length > max) {
    throw new UnauthorizedException(`Wait attestation has an invalid ${name} claim`);
  }
  return claim;
}

function millisecondClaim(claim: unknown, name: string): number {
  if (typeof claim !== 'number' || !Number.isSafeInteger(claim) || claim < 0) {
    throw new UnauthorizedException(`Wait attestation has an invalid ${name} claim`);
  }
  return claim;
}

function jwtTimeClaim(claim: unknown, name: string): number {
  if (typeof claim !== 'number' || !Number.isSafeInteger(claim) || claim < 0) {
    throw new UnauthorizedException(`Wait attestation has an invalid ${name} claim`);
  }
  return claim;
}

@Injectable()
export class WaitAttestationService {
  private readonly jwt = new JwtService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private issuerFor(provider: string): IssuerConfig {
    const raw = this.config.get<string>('WAIT_ATTESTATION_ISSUERS');
    if (!raw) {
      throw new ForbiddenException('No independent wait-attestation provider is configured');
    }
    try {
      const entries = JSON.parse(raw) as unknown;
      if (!Array.isArray(entries)) throw new Error('not an array');
      const found = entries.find(
        (entry): entry is IssuerConfig =>
          !!entry &&
          typeof entry === 'object' &&
          (entry as IssuerConfig).provider === provider &&
          typeof (entry as IssuerConfig).issuer === 'string' &&
          typeof (entry as IssuerConfig).audience === 'string' &&
          !!(entry as IssuerConfig).publicKeys &&
          typeof (entry as IssuerConfig).publicKeys === 'object',
      );
      if (!found) throw new Error('provider not allowlisted');
      return found;
    } catch {
      throw new ForbiddenException('Wait-attestation provider is not allowlisted');
    }
  }

  async createSession(userId: string, dto: CreateWaitAttestationSessionDto) {
    // Validate the configured issuer before issuing a nonce. A missing provider
    // configuration must not create a session that a client could mistake for
    // a billable capability.
    this.issuerFor(dto.provider);
    const device = await this.prisma.device.findUnique({
      where: { id: dto.deviceId },
      select: { userId: true },
    });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Wait-attestation device is not owned by this user');
    }

    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await this.prisma.waitAttestationSession.create({
      data: {
        userId,
        deviceId: dto.deviceId,
        waitStateId: dto.waitStateId,
        clientSessionId: dto.sessionId,
        provider: dto.provider,
        nonceHash: digest(nonce),
        expiresAt,
      },
    });
    await this.audit.logStrict({
      actorId: userId,
      actorRole: 'developer',
      action: 'create_wait_attestation_session',
      targetType: 'wait_attestation_session',
      targetId: session.id,
      afterSnap: {
        provider: dto.provider,
        deviceId: dto.deviceId,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return { attestationSessionId: session.id, nonce, expiresAt: expiresAt.toISOString() };
  }

  async consume(userId: string, dto: ConsumeWaitAttestationDto) {
    const session = await this.prisma.waitAttestationSession.findUnique({
      where: { id: dto.attestationSessionId },
    });
    if (!session || session.userId !== userId) {
      throw new ForbiddenException('Wait-attestation session is not available to this user');
    }
    if (session.consumedAt || session.expiresAt <= new Date()) {
      throw new ConflictException('Wait-attestation session is expired or already consumed');
    }

    const issuer = this.issuerFor(session.provider);
    const { kid } = decodeHeader(dto.assertion);
    const publicKey = issuer.publicKeys[kid]?.replace(/\\n/g, '\n');
    if (!publicKey) {
      throw new UnauthorizedException('Wait attestation was signed with an unknown key id');
    }

    let claims: AttestationClaims;
    try {
      claims = await this.jwt.verifyAsync<AttestationClaims>(dto.assertion, {
        secret: publicKey,
        algorithms: ['RS256'],
        issuer: issuer.issuer,
        audience: issuer.audience,
      });
    } catch {
      throw new UnauthorizedException(
        'Wait attestation signature, issuer, audience, or expiry is invalid',
      );
    }

    const subject = stringClaim(claims.sub, 'sub');
    const deviceId = stringClaim(claims.device_id, 'device_id');
    const nonce = stringClaim(claims.nonce, 'nonce');
    const sessionId = stringClaim(claims.session_id, 'session_id');
    const waitStateId = stringClaim(claims.wait_state_id, 'wait_state_id');
    const provider = stringClaim(claims.provider, 'provider', 64);
    const eventId = stringClaim(claims.event_id, 'event_id', 256);
    const attestationVersion = stringClaim(claims.attestation_version, 'attestation_version', 64);
    const startedAtMs = millisecondClaim(claims.started_at_ms, 'started_at_ms');
    const endedAtMs = millisecondClaim(claims.ended_at_ms, 'ended_at_ms');
    const durationMs = millisecondClaim(claims.duration_ms, 'duration_ms');
    const expiresAtSeconds = jwtTimeClaim(claims.exp, 'exp');
    const notBeforeSeconds = jwtTimeClaim(claims.nbf, 'nbf');

    if (
      subject !== userId ||
      deviceId !== session.deviceId ||
      sessionId !== session.clientSessionId ||
      waitStateId !== session.waitStateId ||
      provider !== session.provider ||
      digest(nonce) !== session.nonceHash
    ) {
      throw new UnauthorizedException(
        'Wait attestation binding does not match its server-issued session',
      );
    }
    const versionAllowlist = (this.config.get<string>('VERIFIED_WAIT_ATTESTATION_VERSIONS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!versionAllowlist.includes(attestationVersion)) {
      throw new UnauthorizedException('Wait attestation version is not allowlisted');
    }
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1_000);
    if (
      endedAtMs < startedAtMs ||
      durationMs <= 0 ||
      durationMs > MAX_DURATION_MS ||
      Math.abs(endedAtMs - startedAtMs - durationMs) > DURATION_TOLERANCE_MS ||
      startedAtMs < session.createdAt.getTime() - CLOCK_SKEW_MS ||
      endedAtMs > now + CLOCK_SKEW_MS ||
      expiresAtSeconds <= nowSeconds ||
      notBeforeSeconds > nowSeconds
    ) {
      throw new UnauthorizedException('Wait attestation timing is outside the accepted bounds');
    }

    // Bind the provider assertion to the server's own lifecycle records as
    // well as to the issued nonce. The provider need not expose prompt text,
    // but it cannot attest a different operation and have it settle this wait.
    const [waitStart, waitEnd] = await Promise.all([
      this.prisma.waitStateEvent.findFirst({
        where: {
          userId,
          deviceId: session.deviceId,
          sessionId: session.clientSessionId,
          waitStateId: session.waitStateId,
          eventType: 'wait_state_start',
        },
        select: { createdAt: true },
      }),
      this.prisma.waitStateEvent.findFirst({
        where: {
          userId,
          deviceId: session.deviceId,
          sessionId: session.clientSessionId,
          waitStateId: session.waitStateId,
          eventType: 'wait_state_end',
        },
        select: { createdAt: true, duration: true },
      }),
    ]);
    if (!waitStart || !waitEnd || waitEnd.duration === null) {
      throw new ConflictException('Wait attestation requires a completed server-recorded wait');
    }
    const serverStartMs = waitStart.createdAt.getTime();
    const serverEndMs = waitEnd.createdAt.getTime();
    const serverDurationMs = waitEnd.duration * 1_000;
    if (
      session.createdAt.getTime() > serverStartMs ||
      startedAtMs < serverStartMs - CLOCK_SKEW_MS ||
      endedAtMs > serverEndMs + CLOCK_SKEW_MS ||
      durationMs > serverDurationMs + CLOCK_SKEW_MS
    ) {
      throw new UnauthorizedException('Wait attestation does not match the server-recorded wait');
    }

    try {
      const accepted = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.waitAttestationSession.updateMany({
          where: { id: session.id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Wait-attestation session was already consumed');
        }
        const record = await tx.waitAttestation.create({
          data: {
            sessionId: session.id,
            userId,
            deviceId: session.deviceId,
            waitStateId: session.waitStateId,
            provider,
            issuer: issuer.issuer,
            keyId: kid,
            attestationVersion,
            providerEventId: eventId,
            assertionDigest: digest(dto.assertion),
            startedAt: new Date(startedAtMs),
            endedAt: new Date(endedAtMs),
            durationMs,
          },
        });
        await this.audit.logStrict(
          {
            actorId: userId,
            actorRole: 'developer',
            action: 'consume_wait_attestation',
            targetType: 'wait_attestation',
            targetId: record.id,
            afterSnap: { provider, issuer: issuer.issuer, keyId: kid, eventId, durationMs },
          },
          tx,
        );
        return record;
      });
      return { id: accepted.id, provider: accepted.provider, durationMs: accepted.durationMs };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // Unique session/event/wait constraints are replay defenses. Do not
      // reveal which provider event or another user's wait caused the clash.
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Wait attestation was already consumed or replayed');
      }
      throw error;
    }
  }
}
