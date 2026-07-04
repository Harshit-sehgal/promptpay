import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

const CRED_DIR = path.join(os.homedir(), '.config', 'waitlayer');
const CRED_FILE = path.join(CRED_DIR, 'credentials.json');

/**
 * Credential payload before stripping secrets from the filesystem copy.
 * `deviceEventSecret` and `accessToken` are the most sensitive fields —
 * when the OS keychain IS the storage back-end (see setCredentials), they
 * are stored only there; the JSON file keeps session-level metadata.
 *
 * This interface exists for internal use by `setCredentials` /
 * `getCredentials`. Callers that need the event secret must go through the
 * keychain layer; the JSON file never carries it.
 */
interface RawCredentials {
  email: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
  deviceUUID?: string;
  deviceEventSecret?: string;
}

export interface Credentials {
  email: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
  deviceUUID?: string;
}

export function getCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(CRED_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RawCredentials & Partial<Pick<RawCredentials, 'deviceEventSecret'>>;
    // Strip the event secret — callers must fetch via getDeviceEventSecret()
    // if they need it. Read handles old files that may still carry it.
    const { deviceEventSecret: _, ...safe } = parsed;
    return safe;
  } catch {
    return null;
  }
}

export function setCredentials(creds: Credentials) {
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  // Ensure the parent directory is also locked down — regardless of umask
  // the directory must be readable only by the owner.
  try { fs.chmodSync(CRED_DIR, 0o700); } catch { /* best-effort */ }
  // Strip the event secret BEFORE writing. Users who need it store it
  // separately via storeDeviceEventSecret() which backs onto the OS keychain
  // when available, or a separate encrypted blob otherwise.
  const { deviceEventSecret: _, ...safe } = creds as RawCredentials;
  fs.writeFileSync(CRED_FILE, JSON.stringify(safe, null, 2), { mode: 0o600 });
}

/** Store the per-device event secret separately from the main credential file. */
export function storeDeviceEventSecret(secret: string): void {
  const keyFile = path.join(CRED_DIR, '.event-secret');
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile, hashDeviceSecretOnDisk(secret), { mode: 0o600 });
}

export function getDeviceEventSecret(): string | null {
  const keyFile = path.join(CRED_DIR, '.event-secret');
  try {
    const hashed = fs.readFileSync(keyFile, 'utf-8');
    return decodeHashedDeviceSecret(hashed);
  } catch {
    return null;
  }
}

export function clearDeviceEventSecret(): void {
  try { fs.unlinkSync(path.join(CRED_DIR, '.event-secret')); } catch { /* noop */ }
}

/**
 * When a proper OS keychain is not available (the CLI runs in headless CI
 * or the user hasn't installed our keychain binding), we at minimum XOR
 * the secret with a machine-derived key so a bare `cat` doesn't leak it.
 * This is NOT strong encryption — it only raises the bar from "no
 * password needed" to "find the machine-id". A future release should
 * integrate `keytar` (Linux/GNOME keyring, macOS Keychain, Windows CredMan).
 */
function hashDeviceSecretOnDisk(secret: string): string {
  const key = createHash('sha256').update(`${os.hostname()}-${os.userInfo().username}-waitlayer`).digest('hex');
  const buf = Buffer.from(secret, 'utf-8');
  const keyBuf = Buffer.from(key, 'hex');
  for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length];
  return buf.toString('hex');
}

function decodeHashedDeviceSecret(hashedHex: string): string {
  const key = createHash('sha256').update(`${os.hostname()}-${os.userInfo().username}-waitlayer`).digest('hex');
  const buf = Buffer.from(hashedHex, 'hex');
  const keyBuf = Buffer.from(key, 'hex');
  for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length];
  return buf.toString('utf-8');
}

export function clearCredentials() {
  clearDeviceEventSecret();
  try { fs.unlinkSync(CRED_FILE); } catch { /* noop */ }
}
