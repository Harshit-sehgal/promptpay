import 'dotenv/config';

import { startBridge } from './server.js';

startBridge().catch((error) => {
  console.error('Failed to start wait-attestation bridge:', error);
  process.exit(1);
});
