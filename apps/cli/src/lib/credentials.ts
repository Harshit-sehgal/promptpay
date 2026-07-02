import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CRED_FILE = path.join(
  os.homedir(),
  '.config',
  'waitlayer',
  'credentials.json',
);

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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCredentials(creds: Credentials) {
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function clearCredentials() {
  try {
    fs.unlinkSync(CRED_FILE);
  } catch {
    /* noop */
  }
}
