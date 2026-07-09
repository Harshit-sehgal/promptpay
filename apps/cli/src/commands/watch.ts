import chalk from 'chalk';
import * as fs from 'fs';

import { runAdFlow } from '../lib/ad-flow';
import { ApiClient } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { getErrorCode, getErrorMessage } from '../lib/errors';

const STATE_FILE = `${process.cwd()}/.waitlayer-wait`;

interface WaitState {
  startTime: number;
  tool: string;
}

/**
 * Detects a "wait state" marker file (e.g. created by a script that wraps an
 * AI command) and reports it to WaitLayer. Users can integrate by writing a
 * JSON file before invoking their AI tool:
 *
 *   echo '{"startTime": $(date +%s%3N), "tool": "claude_code"}' > .waitlayer-wait
 *   claude ...                          # AI tool runs
 *   date +%s%3N > .waitlayer-wait       # complete
 *   echo '' > .waitlayer-wait           # clear
 *
 * This CLI command tails the file and reports wait-state events to the API.
 */
export async function runWatch(opts: { once?: boolean; ads?: boolean }) {
  const creds = getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exit(1);
  }

  const api = new ApiClient(creds);
  const serveAds = opts.ads ?? true;

  console.log(chalk.cyan('WaitLayer watch') + chalk.dim(` — watching ${STATE_FILE}`));
  console.log(chalk.dim('Press Ctrl+C to stop.'));

  let lastState: WaitState | null = null;
  let activeWaitStateId: string | null = null;
  let activeStartTime: number | null = null;
  // A-040: Ad flow uses the tested runAdFlow() helper. Since the wait-state
  // duration is unknown until the marker file is removed/emptied, we split:
  //   - poll() runs requestAd + recordAdRendered (first half of runAdFlow)
  //   - endActiveWait() calls recordImpressionQualified (second half) using
  //     the total elapsed duration, matching runAdFlow's qualify logic.
  // We track the impressionToken here so the qualify call in endActiveWait
  // can reference the same impression.
  let activeImpressionToken: string | null = null;

  /** End the current active wait state and reset tracking. Shared by both
   *  the file-empty and ENOENT paths — ensures the wait-end logic lives in
   *  one place rather than being duplicated across try/catch branches. */
  const endActiveWait = async () => {
    if (!activeWaitStateId || activeStartTime === null) return;
    const durationMs = Date.now() - activeStartTime;
    const durationSeconds = Math.floor(durationMs / 1000);
    console.log(chalk.dim(`[wait-end] ${activeWaitStateId} — ${durationMs}ms (${durationSeconds}s)`));

    try {
      await api.endWaitState({ waitStateId: activeWaitStateId, durationSeconds });
    } catch (err: unknown) {
      console.error(chalk.red(`end wait-state error: ${getErrorMessage(err)}`));
    }

    // A-040: Qualify the impression via runAdFlow's logic if the wait state
    // lasted long enough.  We preserve the original order (endWaitState first,
    // qualify second) to minimize behavioral changes from the refactoring.
    if (activeImpressionToken && durationMs >= 5000) {
      try {
        await api.recordImpressionQualified({
          impressionToken: activeImpressionToken,
          qualifiedAt: new Date().toISOString(),
          visibleDurationMs: durationMs,
          idempotencyKey: `imp-${activeImpressionToken}`,
        });
      } catch (err: unknown) {
        console.error(chalk.red(`ad qualify error: ${getErrorMessage(err)}`));
      }
    }

    activeWaitStateId = null;
    activeStartTime = null;
    activeImpressionToken = null;
    lastState = null;
  };

  const poll = async () => {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8').trim();

      // ── Wait state ended (file removed/emptied) ──
      if (!raw) {
        await endActiveWait();
        return;
      }

      const state = JSON.parse(raw) as WaitState;
      if (!state.startTime || state.startTime === lastState?.startTime) {
        return;
      }

      const durationMs = Date.now() - state.startTime;
      if (durationMs < 1000) return;

      console.log(chalk.dim(`[wait] ${state.tool} — ${durationMs}ms`));

      // Generate a stable waitStateId for this wait period
      const waitStateId = `cli-${state.startTime}-${state.tool}`;
      // One stable session id shared by the wait-state start and the ad request
      // so the API can correlate them (issue A-064).
      const sessionId = `cli-${waitStateId}`;

      const deviceId = await api.getOrRegisterDevice();

      await api.reportWaitState({
        deviceId,
        waitStateId,
        toolType: state.tool,
        sessionId,
      });

      // A-040: Serve an ad during the wait state using the tested runAdFlow()
      // helper. Because the total wait-state duration is unknown until the file
      // is removed, runAdFlow handles request + render now; the qualify step
      // happens in endActiveWait() when the total duration is known.
      if (serveAds) {
        try {
          const result = await runAdFlow(api, {
            deviceId,
            sessionId,
            waitStateId,
            toolType: state.tool,
            idempotencyKey: `cli-ad-${waitStateId}`,
            // The wait state is still in progress — we can't know the total
            // duration yet. Pass a short duration so runAdFlow renders the ad
            // but does NOT qualify it yet (qualify only happens when >= 5000ms).
            // The qualify step will run in endActiveWait() with the real total.
            durationMs: 0,
          });
          if (result.served && result.impressionToken) {
            activeImpressionToken = result.impressionToken;
            console.log(chalk.dim('[ad] served'));
          }
        } catch (err: unknown) {
          console.error(chalk.red(`ad error: ${getErrorMessage(err)}`));
        }
      }

      activeWaitStateId = waitStateId;
      activeStartTime = state.startTime;
      lastState = state;
    } catch (err: unknown) {
      if (getErrorCode(err) === 'ENOENT') {
        // File disappeared — treat as wait state end
        await endActiveWait();
      } else {
        console.error(chalk.red(`watch error: ${getErrorMessage(err)}`));
      }
    }
  };

  // ── SIGINT/SIGTERM cleanup ──
  // Send the final endWaitState before the process exits so we don't leave
  // dangling wait states on the server when the user presses Ctrl+C.
  const handleSignal = async () => {
    await endActiveWait();
    process.exit(0);
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  if (opts.once) {
    await poll();
    return;
  }

  setInterval(poll, 3000);
}
