import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWatch } from './watch';

// Mock API client + fs so the full wait-state → ad loop runs without network.
// The ad flow (requestAd/recordAdRendered/recordImpressionQualified) is driven
// by runAdFlow() inside watch.ts, which calls these same mock methods.
const mocks = vi.hoisted(() => {
  const api = {
    getOrRegisterDevice: vi.fn().mockResolvedValue('dev_1'),
    reportWaitState: vi.fn().mockResolvedValue(undefined),
    endWaitState: vi.fn().mockResolvedValue(undefined),
    requestAd: vi.fn().mockResolvedValue({
      impressionToken: 'imp_1',
      campaignId: 'c1',
      creativeId: 'cr1',
      title: 't',
      message: 'm',
      label: 'l',
      displayDomain: 'd',
      destinationUrl: 'https://example.com',
    }),
    recordAdRendered: vi.fn().mockResolvedValue(undefined),
    recordImpressionQualified: vi.fn().mockResolvedValue(undefined),
  };
  let fileContents = '';
  const readFileSync = vi.fn(() => fileContents);
  return {
    api,
    setFileContents: (v: string) => {
      fileContents = v;
    },
    readFileSync,
  };
});

vi.mock('../lib/credentials', () => ({
  getCredentials: vi.fn(() => ({
    apiUrl: 'https://api.waitlayer.com/api/v1',
    token: 'tok',
    deviceUUID: 'dev_1',
  })),
}));

vi.mock('../lib/api-client', () => ({
  ApiClient: class {
    getOrRegisterDevice = mocks.api.getOrRegisterDevice;
    reportWaitState = mocks.api.reportWaitState;
    endWaitState = mocks.api.endWaitState;
    requestAd = mocks.api.requestAd;
    recordAdRendered = mocks.api.recordAdRendered;
    recordImpressionQualified = mocks.api.recordImpressionQualified;
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: mocks.readFileSync };
});

const T0 = 1_700_000_000_000;

describe('runWatch CLI ad-flow loop (A-040)', () => {
  let capturedPoll: (() => Promise<void>) | null = null;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    mocks.api.getOrRegisterDevice.mockClear();
    mocks.api.reportWaitState.mockClear();
    mocks.api.endWaitState.mockClear();
    mocks.api.requestAd.mockClear();
    mocks.api.recordAdRendered.mockClear();
    mocks.api.recordImpressionQualified.mockClear();
    mocks.readFileSync.mockClear();
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((cb) => {
      capturedPoll = cb as () => Promise<void>;
      return 0 as unknown as NodeJS.Timeout;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    setIntervalSpy.mockRestore();
    vi.restoreAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  async function startWatchAndCapture(): Promise<() => Promise<void>> {
    void runWatch({ once: false, ads: true });
    // Let runWatch's async body progress to the setInterval(poll) registration.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    if (!capturedPoll) throw new Error('poll callback was not registered');
    return capturedPoll;
  }

  const waitState = (tool = 'terminal') => JSON.stringify({ startTime: T0, tool });
  const sessionId = `cli-cli-${T0}-terminal`;
  const waitStateId = `cli-${T0}-terminal`;

  it('reports one stable cli-<waitStateId> session across the wait-state → ad loop', async () => {
    const poll = await startWatchAndCapture();

    mocks.setFileContents(waitState());
    vi.setSystemTime(new Date(T0 + 2000));
    await poll();

    mocks.setFileContents('');
    vi.setSystemTime(new Date(T0 + 6000));
    await poll();

    expect(mocks.api.reportWaitState).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, waitStateId }),
    );
    expect(mocks.api.requestAd).toHaveBeenCalledWith(expect.objectContaining({ sessionId }));
    expect(mocks.api.recordAdRendered).toHaveBeenCalledOnce();
    expect(mocks.api.recordImpressionQualified).toHaveBeenCalledOnce();
    expect(mocks.api.endWaitState).toHaveBeenCalledWith(expect.objectContaining({ waitStateId }));
  });

  it('does NOT qualify the impression when the wait ends before the minimum visible duration', async () => {
    const poll = await startWatchAndCapture();

    mocks.setFileContents(waitState());
    vi.setSystemTime(new Date(T0 + 2000));
    await poll();

    // Wait state ends at 4000ms total — below the 5000ms minimum.
    mocks.setFileContents('');
    vi.setSystemTime(new Date(T0 + 4000));
    await poll();

    expect(mocks.api.recordAdRendered).toHaveBeenCalledOnce();
    expect(mocks.api.recordImpressionQualified).not.toHaveBeenCalled();
  });

  it('qualifies the impression when the wait lasts at/after the minimum visible duration', async () => {
    const poll = await startWatchAndCapture();

    mocks.setFileContents(waitState());
    vi.setSystemTime(new Date(T0 + 2000));
    await poll();

    // Wait state ends at 6000ms total — at/after the 5000ms minimum.
    mocks.setFileContents('');
    vi.setSystemTime(new Date(T0 + 6000));
    await poll();

    expect(mocks.api.recordAdRendered).toHaveBeenCalledOnce();
    expect(mocks.api.recordImpressionQualified).toHaveBeenCalledOnce();
  });
});
