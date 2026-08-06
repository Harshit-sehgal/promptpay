#!/usr/bin/env node
const { FraudService } = await import('../../apps/api/dist/apps/api/src/fraud/fraud.service.js');
const service = Object.create(FraudService.prototype);
let flag;
service.prisma = {
  adImpression: {
    findMany: async () => Array.from({ length: 10 }, (_, index) => ({ createdAt: new Date(`2026-08-06T00:00:${String(index * 5).padStart(2, '0')}.000Z`) })),
  },
};
service.createFlag = async (input) => { flag = input; return { id: 'scenario-fraud-flag' }; };
await service.checkAutomatedPattern('scenario-user');
if (!flag || flag.flagType !== 'automated_pattern' || flag.severity !== 'high') throw new Error('regular automated click pattern was not flagged');
process.stdout.write(`${JSON.stringify([{ eventId: 'scenario-automated-clicks', eventType: 'adversarial.automated_clicks', mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata: { flagged: true } }])}\n`);
