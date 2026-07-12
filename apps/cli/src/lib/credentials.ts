import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CRED_DIR = path.join(os.homedir(), '.config', 'waitlayer');
const CRED_FILE = path.join(CRED_DIR, 'credentials.json');

// OS keychain coordinates for the per-device event secret. When a keychain
// backend (keytar: GNOME Keyring / macOS Keychain / Windows CredMan) is
// available, the secret lives ONLY there; otherwise we fall back to the local
// XOR-obfuscated file (dev/CI only — production refuses the fallback).
const KEYCHAIN_SERVICE = 'waitlayer-cli';
const KEYCHAIN_ACCOUNT = 'device-event-secret';

// OS keychain coordinates for the access/refresh tokens. Same back-end as the
// event secret above; when a keychain is available the tokens live ONLY there
// and the plaintext credential file never carries them. When no keychain is
// available (headless CI) we fall back to a separate 0o600 file — unlike the
// event secret, tokens do NOT fail-closed in production, since CI and local
// dev must be able to run without a desktop keychain integration.
const TOKENS_ACCOUNT = 'device-access-tokens';

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
    const mod = await import(modName);
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
          new Entry(service, account)
            .deletePassword()
            .then(() => true)
            .catch(() => false),
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
 * `deviceEventSecret` and `accessToken`/`refreshToken` are the most sensitive
 * fields — when the OS keychain IS the storage back-end, they are stored only
 * there; the JSON file keeps session-level metadata and never carries them.
 *
 * This interface exists for internal use by `setCredentials` /
 * `getCredentials`. Callers that need the event secret must go through the
 * keychain layer; the JSON file never carries it. Tokens are read back via
 * `loadTokens()` (keychain, or the plaintext fallback when no keychain).
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

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export async function getCredentials(): Promise<Credentials | null> {
  let parsed: (RawCredentials & Partial<Pick<RawCredentials, 'deviceEventSecret'>>) | null = null;
  try {
    const raw = fs.readFileSync(CRED_FILE, 'utf-8');
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  // Strip the event secret — callers must fetch via getDeviceEventSecret()
  // if they need it. Read handles old files that may still carry it.
  const { deviceEventSecret: _dev, ...rest } = parsed;
  const safe = rest as Omit<RawCredentials, 'deviceEventSecret'>;

  // Tokens are stored in the OS keychain (or a plaintext fallback when the
  // keychain is unavailable) rather than the credential file. Load them now so
  // callers still receive a complete Credentials object. Legacy files that
  // still inline the tokens act as a fallback until the next write.
  //
  // Prefer tokens that are explicitly present in the credential file. This
  // supports headless/CI setups that inject credentials.json directly and
  // prevents a stale keychain entry from silently overriding freshly
  // written credentials.
  const stored = await loadTokens();
  const accessToken = safe.accessToken || stored?.accessToken;
  const refreshToken = safe.refreshToken || stored?.refreshToken;
  if (!accessToken || !refreshToken) {
    return null;
  }
  if (safe.accessToken && stored?.accessToken !== safe.accessToken) {
    // Keep the keychain in sync with the explicit credential file so a
    // future read that falls back to the keychain does not resurrect an
    // old token. Only attempt the sync when a keychain backend is actually
    // present; otherwise the write would go to the plaintext fallback and
    // is unnecessary because the credential file is already authoritative.
    const keytar = await loadKeytar();
    if (keytar) {
      try {
        await saveTokens({ accessToken, refreshToken });
      } catch {
        // Best-effort sync; the in-memory tokens are still valid.
      }
    }
  }

  return {
    email: safe.email,
    accessToken,
    refreshToken,
    userId: safe.userId,
    role: safe.role,
    ...(safe.deviceUUID ? { deviceUUID: safe.deviceUUID } : {}),
  };
}

export async function setCredentials(creds: Credentials): Promise<void> {
  // Tokens are stored in the OS keychain (or a plaintext fallback) rather than
  // the credential file. Persist them separately first.
  if (creds.accessToken || creds.refreshToken) {
    await saveTokens({ accessToken: creds.accessToken, refreshToken: creds.refreshToken });
  }
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  // Ensure the parent directory is also locked down — regardless of umask
  // the directory must be readable only by the owner.
  try {
    fs.chmodSync(CRED_DIR, 0o700);
  } catch {
    console.warn('[waitlayer] Failed to set credentials directory permissions');
  }
  // Strip the event secret AND the tokens BEFORE writing. The event secret is
  // stored via storeDeviceEventSecret(); the tokens via saveTokens(). The JSON
  // file never carries either in cleartext.
  const {
    deviceEventSecret: _dev,
    accessToken: _at,
    refreshToken: _rt,
    ...safe
  } = creds as RawCredentials;
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
 * Persist the access/refresh tokens in the OS keychain when available,
 * otherwise fall back to a plaintext 0o600 file (headless CI / no keychain).
 * The keyring path is preferred so the tokens are never written to disk in
 * cleartext on developer machines and production servers that have a keychain.
 */
export async function saveTokens(tokens: Tokens): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, TOKENS_ACCOUNT, JSON.stringify(tokens));
      return;
    } catch {
      console.warn('[waitlayer] OS keychain write failed; storing tokens in local fallback');
    }
  }
  // Plaintext fallback (headless CI / no keychain). The directory is 0o700 and
  // the file is 0o600 — treat this as the only path when no keychain exists.
  const tokensFile = path.join(CRED_DIR, '.tokens');
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokensFile, JSON.stringify(tokens), { mode: 0o600 });
  try {
    fs.chmodSync(tokensFile, 0o600);
  } catch {
    /* noop — permissions may be fixed by the directory */
  }
}

/**
 * Load the access/refresh tokens from the OS keychain when available,
 * otherwise from the plaintext 0o600 fallback file. Returns null when no
 * tokens are stored either way.
 */
export async function loadTokens(): Promise<Tokens | null> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYCHAIN_SERVICE, TOKENS_ACCOUNT);
      if (raw) {
        try {
          return JSON.parse(raw) as Tokens;
        } catch {
          /* ignore corrupt keyring entry */
        }
      }
    } catch {
      // fall through to the local file fallback
    }
  }
  const tokensFile = path.join(CRED_DIR, '.tokens');
  try {
    const raw = fs.readFileSync(tokensFile, 'utf-8');
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, TOKENS_ACCOUNT);
    } catch {
      /* noop — keychain entry may not exist */
    }
  }
  try {
    fs.unlinkSync(path.join(CRED_DIR, '.tokens'));
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
  const key = createHash('sha256')
    .update(`${os.hostname()}-${os.userInfo().username}-waitlayer`)
    .digest('hex');
  const buf = Buffer.from(secret, 'utf-8');
  const keyBuf = Buffer.from(key, 'hex');
  for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length];
  return buf.toString('hex');
}

function decodeHashedDeviceSecret(hashedHex: string): string {
  const key = createHash('sha256')
    .update(`${os.hostname()}-${os.userInfo().username}-waitlayer`)
    .digest('hex');
  const buf = Buffer.from(hashedHex, 'hex');
  const keyBuf = Buffer.from(key, 'hex');
  for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length];
  return buf.toString('utf-8');
}

export async function clearCredentials(): Promise<void> {
  // Best-effort keychain clears (fire-and-forget; the file unlink below is the
  // authoritative local cleanup).
  void clearDeviceEventSecret();
  void clearTokens();
  try {
    fs.unlinkSync(CRED_FILE);
  } catch {
    /* noop — file may not exist */
  }
}
