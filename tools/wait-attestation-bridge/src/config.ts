import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BridgeConfig {
  port: number;
  provider: string;
  issuer: string;
  audience: string;
  attestationVersion: string;
  bridgeToken: string;
  privateKeyPath: string;
  publicKeyPath: string;
  generateKeyPair: boolean;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readEnvFile(path: string): string {
  return readFileSync(path, 'utf8').trim();
}

export function loadConfig(): BridgeConfig {
  const privateKeyPath = getEnv('PRIVATE_KEY_PATH', '.keys/bridge-private.pem');
  const publicKeyPath = getEnv('PUBLIC_KEY_PATH', '.keys/bridge-public.pem');

  let bridgeToken: string;
  const tokenPath = process.env.BRIDGE_TOKEN_PATH;
  if (tokenPath) {
    bridgeToken = readEnvFile(tokenPath);
  } else {
    bridgeToken = getEnv('BRIDGE_TOKEN');
  }

  return {
    port: Number.parseInt(getEnv('PORT', '4003'), 10),
    provider: getEnv('ATTESTATION_PROVIDER', 'waitlayer-stub-bridge'),
    issuer: getEnv('ISSUER', 'https://waitlayer.local/attestation'),
    audience: getEnv('AUDIENCE', 'waitlayer-client'),
    attestationVersion: getEnv('ATTESTATION_VERSION', 'stub-v1'),
    bridgeToken,
    privateKeyPath: join(process.cwd(), privateKeyPath),
    publicKeyPath: join(process.cwd(), publicKeyPath),
    generateKeyPair: getEnv('GENERATE_KEY_PAIR', 'true') === 'true',
  };
}
