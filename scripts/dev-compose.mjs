import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const composeArgs = process.argv.slice(2);
const result = spawnSync('docker', ['compose', ...(composeArgs.length > 0 ? composeArgs : ['up'])], {
  env: {
    ...process.env,
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not start Docker Compose: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
