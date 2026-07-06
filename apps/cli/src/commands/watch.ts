import chalk from 'chalk';
import * as fs from 'fs';
import { getCredentials } from '../lib/credentials';
import { ApiClient } from '../lib/api-client';
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
export async function runWatch(opts: { once?: boolean }) {
  const creds = getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exit(1);
  }

  const api = new ApiClient(creds);

  console.log(chalk.cyan('WaitLayer watch') + chalk.dim(` — watching ${STATE_FILE}`));
  console.log(chalk.dim('Press Ctrl+C to stop.'));

  let lastState: WaitState | null = null;
  // Track the current waitStateId we reported so we can send end when the file is removed
  let activeWaitStateId: string | null = null;
  let activeStartTime: number | null = null;

  /** End the current active wait state and reset tracking. Shared by both
   *  the file-empty and ENOENT paths — ensures the wait-end logic lives in
   *  one place rather than being duplicated across try/catch branches. */
  const endActiveWait = async () => {
    if (!activeWaitStateId || activeStartTime === null) return;
    const durationMs = Date.now() - activeStartTime;
    console.log(chalk.dim(`[wait-end] ${activeWaitStateId} — ${durationMs}ms`));
    try {
      await api.endWaitState({ waitStateId: activeWaitStateId, durationMs });
    } catch (err: unknown) {
      console.error(chalk.red(`end wait-state error: ${getErrorMessage(err)}`));
    }
    activeWaitStateId = null;
    activeStartTime = null;
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

      const deviceId = await api.getOrRegisterDevice();

      await api.reportWaitState({
        deviceId,
        waitStateId,
        toolType: state.tool,
      });

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
