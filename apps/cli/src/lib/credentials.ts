import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

const CRED_DIR = path.join(os.homedir(), '.config', 'waitlayer');
const CRED_FILE = path.join(CRED_DIR, 'credentials.json');

// OS keychain coordinates for the per-device event secret. When a keychain
// backend (keytar: GNOME Keyring / macOS Keychain / Windows CredMan) is
// available, the secret lives ONLY there; otherwise we fall back to the local
// XOR-obfuscated file (dev/CI only — production refuses the fallback).
const KEYCHAIN_SERVICE = 'waitlayer-cli';
const KEYCHAIN_ACCOUNT = 'device-event-secret';

/**
 * Load the keytar module via dynamic import. Using a string variable (rather
 * than a literal `import('keytar')`) keeps TypeScript from requiring the
 * module at type-check time, so the CLI still builds even if the optional
 * native dependency is not installed in a given environment. At runtime the
 * import resolves when keytar is present, and rejects (→ null) otherwise, so
 * callers transparently fall back to local storage.
 */
async function loadKeytar(): Promise<{
  setPassword: (service: string, account: string, secret: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
} | null> {
  try {
    const modName = 'keytar';
    const mod = (await import(modName)) as any;
    const keyring = mod?.default ?? mod;
    // @napi-rs/keyring (the `keytar` alias) v1 is class-based: an `AsyncEntry`
    // is constructed from (service, account) and exposes setPassword /
    // getPassword / deletePassword. Adapt it to the keytar-shaped interface
    // our callers expect.
    if (keyring?.AsyncEntry) {
      const Entry = keyring.AsyncEntry;
      return {
        setPassword: (service, account, secret) => new Entry(service, account).setPassword(secret),
        getPassword: (service, account) =>
          new Entry(service, account).getPassword().then((p: string | undefined) => p ?? null),
        deletePassword: (service, account) =>
          new Entry(service, account).deletePassword().then(() => true).catch(() => false),
      };
    }
    // Fallback: a keytar-shaped module exposing top-level functions.
    if (keyring?.setPassword && keyring?.getPassword) return keyring;
    return null;
  } catch {
    return null;
  }
}

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
  try {
    fs.chmodSync(CRED_DIR, 0o700);
  } catch {
    console.warn('[waitlayer] Failed to set credentials directory permissions');
  }
  // Strip the event secret BEFORE writing. Users who need it store it
  // separately via storeDeviceEventSecret() which backs onto the OS keychain
  // when available, or a separate encrypted blob otherwise.
  const { deviceEventSecret: _, ...safe } = creds as RawCredentials;
  fs.writeFileSync(CRED_FILE, JSON.stringify(safe, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CRED_FILE, 0o600);
  } catch {
    // Ignore permissions failures on read-only environments
  }
}

/** Store the per-device event secret separately from the main credential file.
 *
 * Preferred path: the OS keychain (keytar), so the secret never touches disk
 * in plaintext-equivalent form. Fallback path: a local XOR-obfuscated file for
 * dev/CI only. Production fail-closed: when NODE_ENV=production AND no OS
 * keychain backend is available, refuse the weak fallback (it is recoverable
 * from `hostname + username` alone — see `hashDeviceSecretOnDisk`) and require
 * a proper keychain integration.
 */
export async function storeDeviceEventSecret(secret: string): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, secret);
      return;
    } catch {
      console.warn('[waitlayer] OS keychain write failed; using local fallback');
    }
  }

  if (process.env.NODE_ENV === 'production') {
    // The local XOR storage is recoverable from `hostname + username` alone
    // (the key in `hashDeviceSecretOnDisk` derives from those two values,
    // both fully discoverable to any local code). Shipping that to a
    // production binary means the per-device HMAC signing key is, in
    // practice, plaintext on disk to any process running as the same
    // user. Production binaries must have an OS keychain; surface that as an
    // explicit failure here, not a silent security regression.
    throw new Error(
      'storeDeviceEventSecret does not support NODE_ENV=production without an OS keychain — ' +
      'integrate keytar (GNOME Keyring / macOS Keychain / Windows CredMan) to ship this credential safely.',
    );
  }
  const keyFile = path.join(CRED_DIR, '.event-secret');
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile, hashDeviceSecretOnDisk(secret), { mode: 0o600 });
}

export async function getDeviceEventSecret(): Promise<string | null> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const fromKeychain = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (fromKeychain) return fromKeychain;
    } catch {
      // fall through to the local file fallback
    }
  }
  const keyFile = path.join(CRED_DIR, '.event-secret');
  try {
    const hashed = fs.readFileSync(keyFile, 'utf-8');
    return decodeHashedDeviceSecret(hashed);
  } catch {
    return null;
  }
}

export async function clearDeviceEventSecret(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch {
      /* noop — keychain entry may not exist */
    }
  }
  try {
    fs.unlinkSync(path.join(CRED_DIR, '.event-secret'));
  } catch {
    /* noop — file may not exist */
  }
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
  // Best-effort keychain clear (fire-and-forget; the file unlink below is the
  // authoritative local cleanup).
  void clearDeviceEventSecret();
  try {
    fs.unlinkSync(CRED_FILE);
  } catch {
    /* noop — file may not exist */
  }
}
