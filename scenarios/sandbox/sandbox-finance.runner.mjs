import { SandboxService } from '../../apps/api/dist/apps/api/src/sandbox/sandbox.service.js';

const mode = process.argv[2];
const userId = 'scenario-sandbox-finance-user';

function event(eventType, metadata) {
  return {
    eventId: `scenario-${mode}-${eventType}`,
    eventType,
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
    metadata,
  };
}

function makePrisma(initialBalance) {
  const state = {
    balanceMinor: BigInt(initialBalance),
    accountId: 'scenario-xts-account',
    simulations: new Map(),
    entries: [],
  };
  const account = () => ({
    id: state.accountId,
    userId,
    environmentId: 'scenario-sandbox-run',
    currency: 'XTS',
    balanceMinor: state.balanceMinor,
  });
  const tx = {
    $executeRaw: async () => 1,
    sandboxCreditAccount: {
      upsert: async () => account(),
      findUnique: async () => account(),
      update: async ({ data }) => {
        if (typeof data.balanceMinor?.increment === 'bigint') state.balanceMinor += data.balanceMinor.increment;
        if (typeof data.balanceMinor?.decrement === 'bigint') state.balanceMinor -= data.balanceMinor.decrement;
        return { balanceMinor: state.balanceMinor };
      },
    },
    sandboxCreditEntry: {
      findUnique: async () => null,
      count: async () => 0,
      aggregate: async () => ({ _sum: { amountMinor: 0n } }),
      create: async ({ data }) => {
        state.entries.push(data);
        return { amountMinor: data.amountMinor };
      },
    },
    sandboxPayoutSimulation: {
      findUnique: async ({ where }) => {
        const existing = state.simulations.get(where.idempotencyKey);
        return existing ? { ...existing, account: { balanceMinor: state.balanceMinor } } : null;
      },
      create: async ({ data }) => {
        const created = {
          id: data.id,
          status: data.status,
          amountMinor: data.amountMinor,
          currency: data.currency,
          providerTxId: data.providerTxId,
        };
        state.simulations.set(data.idempotencyKey, created);
        return created;
      },
    },
    sandboxDepositSimulation: {
      findUnique: async ({ where }) => {
        const existing = state.simulations.get(where.idempotencyKey);
        return existing ? { ...existing, account: { balanceMinor: state.balanceMinor } } : null;
      },
      create: async ({ data }) => {
        const created = {
          id: data.id,
          status: data.status,
          amountMinor: data.amountMinor,
          currency: data.currency,
          providerTxId: data.providerTxId,
        };
        state.simulations.set(data.idempotencyKey, created);
        return created;
      },
    },
  };
  return { ...tx, $transaction: async (callback) => callback(tx), state };
}

function serviceFor(prisma) {
  return new SandboxService(prisma, {
    get: (key, fallback) =>
      key === 'WAITLAYER_ENVIRONMENT_KIND'
        ? 'sandbox'
        : key === 'WAITLAYER_ENVIRONMENT_ID'
          ? 'scenario-sandbox-run'
          : fallback,
  });
}

async function runDeposit(outcome) {
  const prisma = makePrisma(0n);
  const result = await serviceFor(prisma).simulateDeposit(userId, {
    amountMinor: 5_000,
    outcome,
    idempotencyKey: `deposit-${outcome}`,
  });
  const expectedBalance = outcome === 'approved' ? '5000' : '0';
  if (result.status !== outcome || result.balanceMinor !== expectedBalance || result.hasCashValue !== false)
    throw new Error(`deposit ${outcome} invariant failed`);
  process.stdout.write(`${JSON.stringify([event(`sandbox.deposit.${outcome}`, {
    balanceMinor: result.balanceMinor,
    entryCount: prisma.state.entries.length,
  })])}\n`);
}

async function runPayout(outcome) {
  const prisma = makePrisma(10_000n);
  const service = serviceFor(prisma);
  if (outcome === 'duplicate_request') {
    const input = {
      amountMinor: 2_000,
      destinationAlias: 'sandbox:developer',
      outcome: 'paid',
      idempotencyKey: 'payout-duplicate-request',
    };
    const first = await service.simulatePayout(userId, input);
    const second = await service.simulatePayout(userId, input);
    if (first.duplicate || !second.duplicate || first.status !== 'paid' || second.balanceMinor !== '8000')
      throw new Error('duplicate payout was not idempotent');
    process.stdout.write(`${JSON.stringify([event('sandbox.payout.duplicate_request', {
      status: second.status,
      balanceMinor: second.balanceMinor,
      duplicate: second.duplicate,
    })])}\n`);
    return;
  }
  const input = {
    amountMinor: 2_000,
    destinationAlias: 'sandbox:developer',
    outcome,
    idempotencyKey: `payout-${outcome}`,
  };
  const result = await service.simulatePayout(userId, input);
  const expectedStatus = ['ambiguous', 'timeout', 'reconciliation_escalation'].includes(outcome)
    ? 'requires_review'
    : outcome === 'callback_before_response'
      ? 'processing'
      : outcome;
  const expectedBalance = ['failed', 'reversed'].includes(outcome) ? '10000' : '8000';
  if (result.status !== expectedStatus || result.balanceMinor !== expectedBalance || result.hasCashValue !== false)
    throw new Error(`payout ${outcome} invariant failed`);
  process.stdout.write(`${JSON.stringify([event(`sandbox.payout.${outcome}`, {
    status: result.status,
    balanceMinor: result.balanceMinor,
    entryCount: prisma.state.entries.length,
  })])}\n`);
}

if (mode.startsWith('deposit-')) await runDeposit(mode.slice('deposit-'.length));
else if (mode.startsWith('payout-')) await runPayout(mode.slice('payout-'.length));
else throw new Error(`unknown sandbox finance mode: ${mode}`);
