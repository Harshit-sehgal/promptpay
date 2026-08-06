import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { SpoolPaths } from './agent-spool';
import { clearAgentTelemetry, enableBridge } from './agent-spool';

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
  installationId?: string;
  deviceEventSecret?: string;
}

export interface Credentials {
  email: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
  deviceUUID?: string;
  /** Stable random per-installation identity; never derived from host attributes. */
  installationId?: string;
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
    ...(safe.installationId ? { installationId: safe.installationId } : {}),
  };
}

/**
 * Return the persisted installation identity, creating it atomically in the
 * credential metadata when this is the first CLI run. The value is random and
 * contains no hostname, username, home path, OS detail, or hardware data.
 *
 * This helper intentionally does not require authentication, so device
 * registration can use the same stable identity before tokens are available.
 */
export async function getOrCreateInstallationId(): Promise<string> {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  const existing = typeof parsed?.installationId === 'string' ? parsed.installationId : undefined;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  const lock = acquireInstallationLock();

  try {
    // Re-read while holding the inter-process lock. Another process may have
    // won the race between the initial read and lock acquisition.
    let lockedMetadata: Record<string, unknown> = {};
    try {
      lockedMetadata = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8')) as Record<string, unknown>;
      const lockedId =
        typeof lockedMetadata.installationId === 'string'
          ? lockedMetadata.installationId
          : undefined;
      if (lockedId && /^[0-9a-f-]{36}$/i.test(lockedId)) return lockedId;
    } catch {
      // The file may not exist or may be a legacy malformed credential file.
    }

    const installationId = randomUUID();
    try {
      fs.chmodSync(CRED_DIR, 0o700);
    } catch {
      // Best effort on filesystems that do not support chmod.
    }

    const next = { ...lockedMetadata, installationId };
    const tempFile = `${CRED_FILE}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(next, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(tempFile, 0o600);
    } catch {
      // Best effort on filesystems that do not support chmod.
    }
    try {
      fs.renameSync(tempFile, CRED_FILE);
    } catch (error: unknown) {
      // Some Windows filesystems reject replacing an existing file with
      // renameSync. The lock makes this fallback safe for this metadata file.
      if (!isAlreadyExistsError(error) && !isPermissionError(error)) throw error;
      try {
        fs.unlinkSync(CRED_FILE);
      } catch {
        // The destination may have disappeared between the two operations.
      }
      fs.renameSync(tempFile, CRED_FILE);
    }
    return installationId;
  } finally {
    releaseInstallationLock(lock);
  }
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
  // file never carries either in cleartext. Preserve an installation identity
  // created before authentication; auth flows do not need to know about it.
  const lock = acquireInstallationLock();
  try {
    const persistedInstallationId = readStoredInstallationId();
    const metadata = {
      ...creds,
      ...(creds.installationId || persistedInstallationId
        ? { installationId: creds.installationId ?? persistedInstallationId }
        : {}),
    } as RawCredentials;
    const { deviceEventSecret: _dev, accessToken: _at, refreshToken: _rt, ...safe } = metadata;
    const tempFile = `${CRED_FILE}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(safe, null, 2), { mode: 0o600 });
      fs.renameSync(tempFile, CRED_FILE);
      try {
        fs.chmodSync(CRED_FILE, 0o600);
      } catch {
        // Ignore permissions failures on read-only environments
      }
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Rename success or an earlier write failure may leave nothing to clean.
      }
    }
  } finally {
    releaseInstallationLock(lock);
  }
  // Re-enable telemetry only after token and credential metadata persistence
  // has completed successfully.
  enableBridge();
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

function acquireInstallationLock(): { file: string; handle: number } {
  const file = `${CRED_FILE}.installation.lock`;
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      const handle = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(handle, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return { file, handle };
    } catch (error: unknown) {
      if (!isAlreadyExistsError(error)) throw error;
      try {
        const ageMs = Date.now() - fs.statSync(file).mtimeMs;
        const lockOwner = readLockOwner(file);
        if (ageMs > 30_000 && (!lockOwner || !isProcessAlive(lockOwner.pid))) {
          fs.unlinkSync(file);
          continue;
        }
      } catch {
        // The lock disappeared between open/stat; retry.
      }
      if (Date.now() >= deadline) {
        throw new Error('WaitLayer credential metadata is locked by another process');
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function readLockOwner(file: string): { pid: number; createdAt: number } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    return typeof parsed.pid === 'number' && typeof parsed.createdAt === 'number'
      ? { pid: parsed.pid, createdAt: parsed.createdAt }
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isFileSystemError(error, 'EPERM');
  }
}

function releaseInstallationLock(lock: { file: string; handle: number }): void {
  try {
    fs.closeSync(lock.handle);
  } finally {
    try {
      fs.unlinkSync(lock.file);
    } catch {
      // Best effort cleanup; stale-lock recovery handles a crashed writer.
    }
  }
}

function readStoredInstallationId(): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8')) as Record<string, unknown>;
    const installationId = parsed.installationId;
    return typeof installationId === 'string' && /^[0-9a-f-]{36}$/i.test(installationId)
      ? installationId
      : undefined;
  } catch {
    return undefined;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return isFileSystemError(error, 'EEXIST');
}

function isPermissionError(error: unknown): boolean {
  return isFileSystemError(error, 'EPERM');
}

function isFileSystemError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === code);
}

export type ClearCredentialsOptions = {
  /** Disposable paths used by isolated tests; production callers use defaults. */
  credentialFile?: string;
  spoolPaths?: SpoolPaths;
  /** Avoid touching the real OS keychain in an isolated disposable fixture. */
  clearKeychain?: boolean;
};

export async function clearCredentials(options: ClearCredentialsOptions = {}): Promise<void> {
  // Clear queued agent telemetry before removing account metadata. The queue
  // may contain events captured while offline and must not survive logout or
  // account deletion for a later account to upload them.
  clearAgentTelemetry(options.spoolPaths);
  // Best-effort keychain clears (fire-and-forget; the file unlink below is the
  // authoritative local cleanup).
  if (options.clearKeychain !== false) {
    void clearDeviceEventSecret();
    void clearTokens();
  }
  try {
    fs.unlinkSync(options.credentialFile ?? CRED_FILE);
  } catch {
    /* noop — file may not exist */
  }
}
