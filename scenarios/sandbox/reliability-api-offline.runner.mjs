process.env.WAITLAYER_API_URL = 'http://127.0.0.1:9/api/v1';

const { ApiClient } = await import('../../apps/cli/dist/lib/api-client.js');
const client = new ApiClient({
  email: 'scenario@example.test',
  accessToken: 'sandbox-token',
  refreshToken: 'sandbox-refresh-token',
  userId: 'scenario-offline-user',
  role: 'developer',
});

let rejected = false;
try {
  await client.getEnvironmentIdentity();
} catch (error) {
  rejected = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code);
}
if (!rejected) throw new Error('offline API request did not fail with a bounded network error');
process.stdout.write(`${JSON.stringify([{
  eventId: 'scenario-api-offline',
  eventType: 'api.offline',
  mode: 'sandbox',
  financialMode: 'sandbox',
  hasCashValue: false,
  metadata: { requestRejected: true, telemetryMustRemainNonBlocking: true },
}])}\n`);
