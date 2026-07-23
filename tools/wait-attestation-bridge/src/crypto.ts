import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  kid: string;
}

function deriveKid(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem.trim()).digest('hex').slice(0, 16);
}

function generatePemPair(): { privateKey: string; publicKey: string; kid: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid: deriveKid(publicKey) };
}

export function loadOrGenerateKeyPair(
  privateKeyPath: string,
  publicKeyPath: string,
  generateIfMissing: boolean,
): KeyPair {
  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
    const publicKeyPem = readFileSync(publicKeyPath, 'utf8');
    const publicKey = createPublicKey(publicKeyPem);
    const jwk = publicKey.export({ format: 'jwk' }) as { kid?: string };
    const kid = jwk.kid?.length ? jwk.kid : deriveKid(publicKeyPem);
    return { privateKeyPem, publicKeyPem, kid };
  }

  if (!generateIfMissing) {
    throw new Error(`Key pair not found at ${privateKeyPath} / ${publicKeyPath}`);
  }

  const { privateKey, publicKey, kid } = generatePemPair();
  mkdirSync(dirname(privateKeyPath), { recursive: true });
  writeFileSync(privateKeyPath, privateKey);
  writeFileSync(publicKeyPath, publicKey);
  return { privateKeyPem: privateKey, publicKeyPem: publicKey, kid };
}
