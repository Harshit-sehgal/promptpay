#!/usr/bin/env node
import crypto from 'node:crypto';

process.env.PRIVACY_HASH_KEY = 'scenario-vm-clone-privacy-key-32-bytes!!';
const { ExtensionDeviceReportTrait } = await import('../../apps/api/dist/apps/api/src/extension/extension-device-report.trait.js');

const installationId = '00000000-0000-4000-8000-000000000086';
const fingerprintHash = crypto.createHmac('sha256', process.env.PRIVACY_HASH_KEY)
  .update(`device-installation:${installationId}`).digest('hex');
let owner = null;
let restricted = false;
let fraudFlag = false;
let auditOutbox = false;
const tx = {
  $executeRaw: async () => 1,
  device: {
    findUnique: async () => null,
    findFirst: async () => owner,
    create: async ({ data }) => {
      const created = { id: `device-${owner ? 'clone' : 'original'}`, ...data };
      if (!owner) owner = { userId: 'user-original', id: created.id };
      return created;
    },
  },
  user: { updateMany: async () => { restricted = true; return { count: 1 }; } },
  fraudFlag: { findFirst: async () => null, create: async () => { fraudFlag = true; return { id: 'flag-vm-clone' }; } },
  auditOutbox: { create: async () => { auditOutbox = true; return { id: 'outbox-vm-clone' }; } },
};
const service = Object.create(ExtensionDeviceReportTrait.prototype);
Object.assign(service, {
  prisma: {
    device: { findUnique: async () => null },
    toolIntegration: { findUnique: async () => null },
    $transaction: async (callback) => callback(tx),
  },
  runtimeConfig: {
    isToolEnabled: async () => true,
    isExtensionVersionAllowed: async () => true,
  },
  fraud: {
    checkVpnProxyPattern: async () => undefined,
    checkEmulatorVmPattern: async () => undefined,
    checkDuplicateAccount: async () => undefined,
  },
  audit: { log: async () => undefined },
  logger: { warn: () => undefined },
});

await service.registerDevice('user-original', {
  toolType: 'vscode', installationId, extensionVersion: '1.0.0', platform: 'linux',
});
await service.registerDevice('user-clone', {
  toolType: 'vscode', installationId, extensionVersion: '1.0.0', platform: 'linux',
});
if (!restricted || !fraudFlag || !auditOutbox) throw new Error('cloned installation was not restricted and queued for review');
process.stdout.write(`${JSON.stringify([{ eventId: 'scenario-vm-clone', eventType: 'adversarial.vm_clone', mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata: { samePseudonym: true, restricted: true, fraudFlag: true } }])}\n`);
