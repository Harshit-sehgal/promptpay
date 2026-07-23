import { importPKCS8, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

import { loadConfig } from './config.js';
import { loadOrGenerateKeyPair } from './crypto.js';

const STUB_DURATION_MS = 5_000;

interface AttestationRequest {
  nonce: string;
  attestationSessionId: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  provider: string;
  operationStartDeadline?: string;
  consumeDeadline?: string;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function send(res: ServerResponse, status: number, payload: unknown) {
  const data = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(data);
}

function isValidRequest(body: unknown): body is AttestationRequest {
  if (!body || typeof body !== 'object') return false;
  const required = [
    'nonce',
    'attestationSessionId',
    'userId',
    'deviceId',
    'sessionId',
    'waitStateId',
    'provider',
  ];
  return required.every((key) => typeof (body as Record<string, unknown>)[key] === 'string');
}

export interface BridgeServer {
  close: () => Promise<void>;
  publicKeyPem: string;
  kid: string;
  port: number;
}

export async function startBridge(config = loadConfig()): Promise<BridgeServer> {
  const keyPair = loadOrGenerateKeyPair(
    config.privateKeyPath,
    config.publicKeyPath,
    config.generateKeyPair,
  );

  const privateKey = await importPKCS8(keyPair.privateKeyPem, 'RS256');

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/attest') {
      send(res, 404, { error: 'not_found' });
      return;
    }

    const authz = req.headers.authorization ?? '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (token !== config.bridgeToken) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      send(res, 400, { error: 'invalid_json' });
      return;
    }

    if (!isValidRequest(body)) {
      send(res, 400, { error: 'invalid_request' });
      return;
    }

    if (body.provider !== config.provider) {
      send(res, 400, { error: 'provider_mismatch' });
      return;
    }

    const startedAtMs = Date.now();
    const durationMs = STUB_DURATION_MS; // stub duration; a real bridge measures the operation
    const endedAtMs = startedAtMs + durationMs;
    const nowSeconds = Math.floor(startedAtMs / 1_000);
    const nbf = nowSeconds - 1;
    const exp = nowSeconds + 300;

    const assertion = await new SignJWT({
      sub: body.userId,
      device_id: body.deviceId,
      nonce: body.nonce,
      session_id: body.sessionId,
      wait_state_id: body.waitStateId,
      provider: config.provider,
      event_id: randomUUID(),
      attestation_version: config.attestationVersion,
      started_at_ms: startedAtMs,
      ended_at_ms: endedAtMs,
      duration_ms: durationMs,
    })
      .setProtectedHeader({ alg: 'RS256', kid: keyPair.kid, typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setExpirationTime(exp)
      .setNotBefore(nbf)
      .sign(privateKey);

    send(res, 200, { assertion });
  });

  return new Promise<BridgeServer>((resolve, reject) => {
    const httpServer = server.listen(config.port, () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine server port'));
        return;
      }
      console.log(`Wait-attestation bridge listening on port ${address.port}`);
      console.log(`Add this key id to WAIT_ATTESTATION_ISSUERS: ${keyPair.kid}`);
      resolve({
        publicKeyPem: keyPair.publicKeyPem,
        kid: keyPair.kid,
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            httpServer.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}
