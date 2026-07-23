import * as crypto from 'crypto';
import * as vscode from 'vscode';

import {
  type DetectorEvidence,
  FalsePositiveReason,
  formatMinorUnits,
  WaitAttestationFlow,
} from '@waitlayer/shared';

import { ctaTextForAd } from './ad-display';
import { AdPanel } from './ad-panel';
import { ApiClient } from './api-client';
import { ConfigurationManager } from './config';
import { AI_TOOL_VALUES } from './detector-adapters';
import { computeSuppressUntil, KNOWN_DETECTOR_SOURCES } from './detector-policy';
import { DetectorState } from './detector-state';
import { formatBreakdown, parseByCurrency, resolveDisplayCurrency } from './earnings';
import { StatusBar } from './status-bar';
import { createVsCodeWaitAssertionProvider } from './wait-attestation-provider';
import { WaitStateDetector } from './wait-detector';

/**
 * Pick the amount+currency to render for a balance entry, honoring the user's
 * `preferredDisplayCurrency` and falling back to the derived primary currency
 * or the legacy scalar (see `earnings.ts`). Never fabricates a conversion.
 */
function displayAmountForEntry(
  entry: { amountMinor: bigint; currency: string; byCurrency?: Record<string, string> },
  preferred: string,
): { amountMinor: bigint; currency: string } {
  const { currency } = resolveDisplayCurrency(
    entry.byCurrency,
    preferred || undefined,
    entry.currency,
  );
  const amount = entry.byCurrency
    ? (parseByCurrency(entry.byCurrency)[currency] ?? entry.amountMinor)
    : entry.amountMinor;
  return { amountMinor: amount, currency };
}

/** Reasons a user may give when reporting a false-positive wait (P1.18). */
// P1 #16: normalized reason CODES are sent to the API (shared contract
// FALSE_POSITIVE_REASONS); labels are display-only.
const FALSE_WAIT_REASONS: ReadonlyArray<{ label: string; value: FalsePositiveReason }> = [
  { label: 'I was actively working, not waiting on AI', value: 'actively_working' },
  { label: 'No AI generation was happening', value: 'no_ai_generation' },
  { label: 'Wait triggered by unrelated activity', value: 'unrelated_activity' },
  { label: 'Other', value: 'other' },
];

/** Action button shown on the in-wait notification (P1.18). */
const REPORT_FALSE_POSITIVE_ACTION: vscode.MessageItem = { title: 'Report false positive' };
export async function activate(context: vscode.ExtensionContext) {
  const config = new ConfigurationManager(context.secrets);
  const api = new ApiClient(config);
  // Persisted detector state (experiment assignment + suppression window).
  const detectorState = new DetectorState(context.globalState);
  const detector = new WaitStateDetector({
    getInactivityTimeoutMs: () => config.getInactivityTimeoutMs(),
    // Per-source kill switch (P1.17 / P1.18): skip disabled detector sources.
    getDisabledSources: () => config.getDisabledDetectorSources(),
    // False-positive suppression (P1.18): suppress NEW waits while active.
    isSuppressed: (now) => detectorState.isSuppressed(now),
  });
  const panel = new AdPanel(context, api);
  const status = new StatusBar();

  // Staged rollout / experiment assignment (P1.17). Enrollment + variant are
  // derived from a stable hash so they survive reloads (persisted in
  // globalState on first enrollment). Default rollout 100 ⇒ everyone in.
  await detectorState.getOrAssignExperiment(
    await config.getDeviceUserId(),
    vscode.env.machineId,
    config.detectorRolloutPercent(),
  );

  // Register status bar
  status.register(context);

  // Frequency cap tracking
  let adTimestamps: number[] = [];
  const sessionId = crypto.randomUUID();
  let activeWaitStateId: string | null = null;
  let flaggedWaitStateId: string | null = null;
  const waitStartPromises = new Map<string, Promise<string | null>>();
  const attestation = new WaitAttestationFlow(api);
  const attestationBegunWaits = new Set<string>();
  const attestedWaits = new Set<string>();
  const pendingInteractions = new Map<
    string,
    { impressionToken: string; visibleDurationMs: number; clicked: boolean }
  >();

  const settleInteraction = async (
    waitStateId: string,
    interaction: { impressionToken: string; visibleDurationMs: number; clicked: boolean },
  ) => {
    if (!attestedWaits.has(waitStateId)) {
      pendingInteractions.set(waitStateId, interaction);
      return;
    }
    await api.recordImpressionEnd(interaction.impressionToken, interaction.visibleDurationMs);
    if (interaction.clicked) await api.recordClick(interaction.impressionToken);
  };

  // Consent is server-authoritative. Refresh it both at activation and after
  // login, because activation can happen before credentials exist or after a
  // user changed their choices on another client.
  const syncServerConsent = async () => {
    const settings = await api.getDeveloperSettings();
    if (
      typeof settings.adsEnabled === 'boolean' &&
      (await config.adsEnabled()) !== settings.adsEnabled
    ) {
      await config.setAdsEnabled(settings.adsEnabled);
    }
    if (typeof settings.waitTelemetryEnabled === 'boolean') {
      await config.setWaitTelemetryEnabled(settings.waitTelemetryEnabled);
    }
  };

  // Register all commands
  const commands: vscode.Disposable[] = [
    vscode.commands.registerCommand('waitlayer.login', async () => {
      if (!(await api.promptLogin())) return;

      // Reflect the authenticated state immediately; the balance request may
      // still be slow or unavailable, but the command target must no longer be
      // Login after credentials have been persisted.
      status.setLoggedIn();
      try {
        await syncServerConsent();
        const bal = await api.getBalance();
        const { amountMinor, currency } = displayAmountForEntry(
          bal.available,
          config.preferredDisplayCurrency(),
        );
        status.setEarnings(amountMinor, currency);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: post-login balance refresh failed — ${msg}`);
      }
    }),
    vscode.commands.registerCommand('waitlayer.logout', async () => {
      try {
        await api.logout();
      } finally {
        status.setLoggedOut();
      }
    }),
    vscode.commands.registerCommand('waitlayer.showEarnings', async () => {
      try {
        const bal = await api.getBalance();
        const preferred = config.preferredDisplayCurrency();
        const { currency, note } = resolveDisplayCurrency(
          bal.available.byCurrency,
          preferred || undefined,
          bal.available.currency,
        );
        const available = bal.available.byCurrency
          ? (parseByCurrency(bal.available.byCurrency)[currency] ?? bal.available.amountMinor)
          : bal.available.amountMinor;
        const pending = bal.pending.byCurrency
          ? (parseByCurrency(bal.pending.byCurrency)[currency] ?? bal.pending.amountMinor)
          : bal.pending.amountMinor;
        const breakdown = formatBreakdown(bal.available.byCurrency);
        const lines = [
          `WaitLayer earnings — ${formatMinorUnits(available, currency)} available`,
          `Pending: ${formatMinorUnits(pending, currency)}`,
          ...(breakdown.length
            ? ['', 'Per-currency breakdown:', ...breakdown.map((b) => `  ${b}`)]
            : []),
          ...(note ? ['', note] : []),
          ...(preferred ? [`Preferred display currency: ${preferred}`] : []),
        ];
        vscode.window.showInformationMessage(lines.join('\n'));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: failed to fetch balance — ${msg}`);
        vscode.window.showErrorMessage(`WaitLayer: failed to fetch balance`);
      }
    }),
    vscode.commands.registerCommand('waitlayer.toggleAds', async () => {
      const enabled = !(await config.adsEnabled());
      try {
        await api.updateAdsEnabled(enabled);
        await config.setAdsEnabled(enabled);
        vscode.window.showInformationMessage(`WaitLayer: ads ${enabled ? 'enabled' : 'disabled'}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: failed to update adsEnabled on server — ${msg}`);
        vscode.window
          .showErrorMessage(`WaitLayer: ads were not changed — ${msg}`, 'Retry')
          .then(
            (choice) => choice === 'Retry' && vscode.commands.executeCommand('waitlayer.toggleAds'),
          );
      }
    }),
    vscode.commands.registerCommand('waitlayer.toggleWaitTelemetry', async () => {
      const enabled = !(await config.waitTelemetryEnabled());
      try {
        await api.updateWaitTelemetryEnabled(enabled);
        await config.setWaitTelemetryEnabled(enabled);
        vscode.window.showInformationMessage(
          enabled
            ? 'WaitLayer: wait telemetry enabled. Detected waits may now be sent to WaitLayer.'
            : 'WaitLayer: wait telemetry disabled. No detected waits will be sent to WaitLayer.',
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`WaitLayer: telemetry was not changed — ${msg}`);
      }
    }),
    vscode.commands.registerCommand('waitlayer.openDashboard', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://waitlayer.com/developer'));
    }),
    vscode.commands.registerCommand('waitlayer.reportFalseWait', async (reason?: string) => {
      if (!(await config.waitTelemetryEnabled())) {
        vscode.window.showInformationMessage(
          'WaitLayer: enable wait telemetry before reporting detection feedback.',
        );
        return;
      }
      if (!activeWaitStateId) {
        vscode.window.showInformationMessage('WaitLayer: no active wait to report');
        return;
      }
      if (flaggedWaitStateId === activeWaitStateId) {
        vscode.window.showInformationMessage(
          'WaitLayer: this wait has already been reported as a false detection',
        );
        return;
      }
      // P1.18 #1 — collect a reason via quick pick when none was supplied.
      // The quick-pick shows labels; the API receives the normalized code.
      // A programmatic reason that matches no known code/label degrades to
      // 'other' rather than becoming a silent no-op (e.g. keybinding args).
      // Tests (and some VS Code quick-pick configurations) may return a raw
      // string; treat any string result as the final reason.
      let picked: (typeof FALSE_WAIT_REASONS)[number] | string | undefined;
      if (reason) {
        picked =
          FALSE_WAIT_REASONS.find((r) => r.value === reason || r.label === reason) ??
          FALSE_WAIT_REASONS.find((r) => r.value === 'other');
      } else {
        const raw = await vscode.window.showQuickPick([...FALSE_WAIT_REASONS], {
          placeHolder: 'Why is this a false detection?',
        });
        picked = raw;
      }
      if (!picked) return;
      const finalReason = typeof picked === 'string' ? picked : picked.value;
      try {
        await api.flagFalsePositive(activeWaitStateId, finalReason);
        attestation.cancel(activeWaitStateId);
        attestationBegunWaits.delete(activeWaitStateId);
        pendingInteractions.delete(activeWaitStateId);
        flaggedWaitStateId = activeWaitStateId;
        // P1.18 #2 — temporarily suppress NEW waits for the configured window
        // so the user isn't immediately re-prompted after a false positive.
        detectorState.setSuppressUntil(
          computeSuppressUntil(config.falsePositiveSuppressionMinutes(), Date.now()),
        );
        vscode.window.showInformationMessage(
          'WaitLayer: thanks — this wait has been flagged as a false detection',
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: failed to flag false-positive wait — ${msg}`);
        vscode.window.showErrorMessage(`WaitLayer: failed to report false wait — ${msg}`);
      }
    }),
    vscode.commands.registerCommand('waitlayer.toggleDetectorSource', async (source?: string) => {
      const target =
        source ??
        (await vscode.window.showQuickPick([...KNOWN_DETECTOR_SOURCES], {
          placeHolder: 'Toggle a detector signal source on/off',
        }));
      if (!target) return;
      const disabled = await config.toggleDetectorSource(target);
      const nowDisabled = disabled.includes(target.toLowerCase());
      vscode.window.showInformationMessage(
        `WaitLayer: detector source '${target}' is now ${nowDisabled ? 'disabled' : 'enabled'}`,
      );
    }),
    vscode.commands.registerCommand('waitlayer.showExperimentAssignment', async () => {
      const assignment = await detectorState.getOrAssignExperiment(
        await config.getDeviceUserId(),
        vscode.env.machineId,
        config.detectorRolloutPercent(),
      );
      const detail = assignment.enrolled
        ? `Enrolled — variant: ${assignment.variant} (bucket ${assignment.bucket}/100)`
        : `Not enrolled (bucket ${assignment.bucket}/100, rollout ${config.detectorRolloutPercent()}%)`;
      vscode.window.showInformationMessage(`WaitLayer detector experiment: ${detail}`);
    }),
    // P1 #12: the manifest advertises this command, so it must be registered.
    // A manually reported wait is a diagnostics / shadow-mode feedback
    // channel ONLY: the detector marks it `manual` + `shadow`, so it never
    // reaches the server and is never billable.
    vscode.commands.registerCommand('waitlayer.triggerManualWait', async (tool?: string) => {
      const target =
        tool ??
        (await vscode.window.showQuickPick([...AI_TOOL_VALUES], {
          placeHolder: 'Which AI tool are you waiting on? (manual report — never billable)',
        }));
      if (!target) return;
      const waitStateId = detector.triggerManualWait(target);
      if (!waitStateId) {
        vscode.window.showInformationMessage(
          `WaitLayer: manual wait not started (source '${target}' is disabled or suppressed)`,
        );
        return;
      }
      vscode.window.showInformationMessage(
        `WaitLayer: manual wait reported for '${target}' (shadow-only — used for detection feedback, never billable)`,
      );
    }),
  ];

  // Wait-state detection — fires when AI assistant shows waiting indicator
  detector.onSignal(async (signal) => {
    if (signal.type === 'wait_start') {
      const event = signal.event;

      // Shadow waits (weak inactivity-only detections or shadowOnly-adapter
      // waits) are local-only and excluded from monetization: record nothing
      // server-side and request no ad, so they create no API traffic, no noisy
      // wait records, and no misleading analytics. The detector still tracks
      // them locally for its own state machine.
      if (event.shadow) return;

      // Establish local UI state synchronously so a user can immediately mark
      // a detection as false. This does not send data anywhere; the network
      // consent check below remains the boundary for all API activity.
      activeWaitStateId = event.waitStateId;
      flaggedWaitStateId = null;

      // Privacy is a hard boundary: do not create an active server-side wait,
      // build evidence, request ads, or contact the device endpoint until the
      // user has explicitly opted into wait telemetry.
      if (!(await config.waitTelemetryEnabled())) {
        if (activeWaitStateId === event.waitStateId) activeWaitStateId = null;
        return;
      }
      // P1.18 #3 — richer in-wait notification explaining the detection and
      // offering a "Report false positive" action. Does not block the ad flow.
      const choice = await vscode.window.showInformationMessage(
        `WaitLayer detected an AI assistant wait (${event.tool}). ` +
          `If this was a false detection, let us know.`,
        REPORT_FALSE_POSITIVE_ACTION,
      );
      if (choice && choice.title === REPORT_FALSE_POSITIVE_ACTION.title) {
        await vscode.commands.executeCommand('waitlayer.reportFalseWait');
      }

      const startPromise = (async (): Promise<string | null> => {
        try {
          // 1. Get or register device (obtains UUID)
          const deviceId = await api.getOrRegisterDevice();
          const idempotencyKey = `ws-start-${event.waitStateId}`;

          // An earning attempt starts its independent proof before the
          // operation. Telemetry-only waits remain valid without an attester.
          if (await config.adsEnabled()) {
            const provider = createVsCodeWaitAssertionProvider();
            if (provider) {
              const userId = (await config.getDeviceUserId()) ?? undefined;
              await attestation.begin({
                deviceId,
                sessionId,
                waitStateId: event.waitStateId,
                provider,
                userId,
              });
              attestationBegunWaits.add(event.waitStateId);
            } else {
              status.showRewardsUnavailable();
            }
          }

          // 2. Register wait state start with API
          await api.waitStateStart({
            deviceId,
            sessionId,
            waitStateId: event.waitStateId,
            toolType: 'vscode',
            idempotencyKey,
            signals: event.signals,
            detectorVersion: event.detectorVersion,
            evidence: buildEvidence(event, sessionId),
          });
          return deviceId;
        } catch (err: unknown) {
          attestation.cancel(event.waitStateId);
          attestationBegunWaits.delete(event.waitStateId);
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`WaitLayer: failed to record wait state start — ${msg}`);
          return null;
        }
      })();
      waitStartPromises.set(event.waitStateId, startPromise);

      const deviceId = await startPromise;
      if (waitStartPromises.get(event.waitStateId) === startPromise) {
        waitStartPromises.delete(event.waitStateId);
      }
      if (!deviceId) {
        if (activeWaitStateId === event.waitStateId) activeWaitStateId = null;
        return;
      }

      // A matching end may arrive while device registration or the start POST
      // is in flight. The end handler waits for this promise; do not continue
      // into ad work once that wait has already finished.
      if (activeWaitStateId !== event.waitStateId) return;

      // Decouple ad request and display from wait start recording
      try {
        if (!(await config.adsEnabled()) || activeWaitStateId !== event.waitStateId) return;
        if (!attestationBegunWaits.has(event.waitStateId)) return;
        if ((await config.inQuietHours()) || activeWaitStateId !== event.waitStateId) return;

        // Enforce frequency cap
        const maxAdsPerHour = await config.getMaxAdsPerHour();
        if (activeWaitStateId !== event.waitStateId) return;
        const now = Date.now();
        adTimestamps = adTimestamps.filter((t) => now - t < 3600_000);
        if (adTimestamps.length >= maxAdsPerHour) {
          console.warn('WaitLayer: frequency cap reached, skipping ad');
          return;
        }

        // 3. Request an ad
        const adResponse = await api.requestAd({
          deviceId,
          sessionId,
          waitStateId: event.waitStateId,
          toolType: 'vscode',
          idempotencyKey: `ad-req-${event.waitStateId}`,
        });
        const ad = adResponse.ad;

        // The server is authoritative for launch mode. In the default
        // fail-closed telemetry_only mode, do not open a sponsored panel that a
        // developer could reasonably interpret as a reward-bearing action.
        if (
          !ad &&
          adResponse.mode === 'telemetry_only' &&
          activeWaitStateId === event.waitStateId
        ) {
          status.showRewardsUnavailable();
          return;
        }

        if (ad && activeWaitStateId === event.waitStateId) {
          adTimestamps.push(now);
          status.showAdServing();

          // 4. Record that the ad was rendered to the user
          await api.recordAdRendered({
            impressionToken: ad.impressionToken,
            renderedAt: new Date().toISOString(),
            idempotencyKey: `render-${ad.impressionToken}`,
          });
          if (activeWaitStateId !== event.waitStateId) return;

          // 5. Show ad in panel. Track when the impression became visible
          const impressionShownAt = Date.now();
          panel.show(
            {
              headline: ad.title,
              message: ad.message,
              ctaText: ctaTextForAd(ad),
              ctaUrl: ad.destinationUrl,
              impressionToken: ad.impressionToken,
            },
            async (clicked) => {
              try {
                const visibleDurationMs = Math.max(0, Date.now() - impressionShownAt);
                // The panel may close before the tool operation ends. Hold the
                // interaction in memory until the independent assertion is
                // consumed; never qualify a reward-bearing impression first.
                await settleInteraction(event.waitStateId, {
                  impressionToken: ad.impressionToken,
                  visibleDurationMs,
                  clicked,
                });
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`WaitLayer: failed to record ad interaction — ${msg}`);
              } finally {
                panel.hide();
              }
            },
          );
        }
      } catch (err: unknown) {
        // Don't disrupt the IDE with a modal, but make the failure visible in
        // the extension's output channel
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: ad request/display failed — ${msg}`);
      }
    } else if (signal.type === 'wait_end') {
      const event = signal.event;
      if (activeWaitStateId === event.waitStateId) {
        activeWaitStateId = null;
        const startPromise = waitStartPromises.get(event.waitStateId);
        // A wait can end while the opt-in check or start request is in flight.
        // With no start promise there is no server-side row to close.
        const startRecorded = startPromise ? (await startPromise) !== null : false;
        if (!startRecorded) {
          if (activeWaitStateId === null) {
            panel.hide();
            status.showIdle();
          }
          return;
        }
        try {
          await api.waitStateEnd({
            waitStateId: event.waitStateId,
            durationSeconds: Math.floor(event.durationMs / 1000),
            idempotencyKey: `ws-end-${event.waitStateId}`,
          });
          if (attestationBegunWaits.has(event.waitStateId)) {
            await attestation.consume(event.waitStateId);
            attestationBegunWaits.delete(event.waitStateId);
            attestedWaits.add(event.waitStateId);
            const interaction = pendingInteractions.get(event.waitStateId);
            if (interaction) {
              pendingInteractions.delete(event.waitStateId);
              await settleInteraction(event.waitStateId, interaction);
            }
          }
        } catch (err: unknown) {
          attestation.cancel(event.waitStateId);
          attestationBegunWaits.delete(event.waitStateId);
          pendingInteractions.delete(event.waitStateId);
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`WaitLayer: failed to record wait state end — ${msg}`);
        } finally {
          // A newer wait can start while this end POST is in flight. Do not
          // hide that wait's panel or overwrite its status when the older end
          // request eventually settles.
          if (activeWaitStateId === null) {
            panel.hide();
            status.showIdle();
          }
        }
      }
    }
  });

  detector.start(context);

  const attestationCleanup: vscode.Disposable = {
    dispose: () => {
      for (const waitStateId of attestationBegunWaits) attestation.cancel(waitStateId);
      attestationBegunWaits.clear();
      pendingInteractions.clear();
    },
  };
  context.subscriptions.push(...commands, attestationCleanup);

  // Fetch server-side consent after boot. A failed initial sync is non-fatal:
  // no local state is changed, and successful login retries this exact path.
  void syncServerConsent().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`WaitLayer: failed to fetch developer settings — ${msg}`);
  });

  // Boot balance fetch. On transient failure (network not up yet at
  // activation time, device not registered) retry once after 30s so the
  // status bar self-heals without the user clicking "login" again. A
  // second failure leaves the status bar as "logged out" — the user
  // can manually run `WaitLayer: Show Earnings` or `WaitLayer: Login`
  // to re-attempt. Without this retry, any extension-activation-time
  // network hiccup permanently showed "logged out" with no recovery path
  // other than IDE restart or explicit login.
  let bootRetried = false;
  const fetchBootBalance = () => {
    api
      .getBalance()
      .then((bal) => {
        const { amountMinor, currency } = displayAmountForEntry(
          bal.available,
          config.preferredDisplayCurrency(),
        );
        status.setEarnings(amountMinor, currency);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!bootRetried) {
          bootRetried = true;
          console.warn(`[WaitLayer] Initial balance fetch failed — retrying in 30s: ${msg}`);
          setTimeout(fetchBootBalance, 30_000);
        } else {
          console.warn(`[WaitLayer] Initial balance fetch failed after retry: ${msg}`);
          status.setLoggedOut();
        }
      });
  };
  fetchBootBalance();
}

function buildEvidence(
  event: { waitStateId: string; tool: string; signals?: { type: string; details?: string }[] },
  _sessionId: string,
): Omit<DetectorEvidence, 'signature' | 'detectorVersion' | 'waitStateId' | 'sessionId'>[] {
  const now = Date.now();
  const evidence: Omit<
    DetectorEvidence,
    'signature' | 'detectorVersion' | 'waitStateId' | 'sessionId'
  >[] = [];
  for (const signal of event.signals ?? []) {
    if (signal.type === 'ai_generation') {
      // P0.1: Heuristic AI-tool name mapping — NOT observed-by-integration.
      // The detector adapters (detector-adapters.ts) explicitly state these
      // are name-based heuristic mappings, not live lifecycle integrations.
      // Using 'inferred' here means a single heuristic ai_generation signal
      // cannot authorize payment (requires ≥2 observed primary types).
      evidence.push({
        type: 'ai_generation',
        sourceType: 'inferred',
        adapterId: `vscode.heuristic.${event.tool}`,
        timestamp: now,
        correlationId: event.waitStateId,
      });
    } else if (signal.type === 'active_task') {
      // P0.1: VS Code's task API emits real onDidStartTask / onDidEndTask
      // events, so active_task from 'vscode.task' is genuinely observed.
      evidence.push({
        type: 'active_task',
        sourceType: 'observed',
        adapterId: 'vscode.task',
        timestamp: now,
        correlationId: event.waitStateId,
      });
    } else if (signal.type === 'command_execution') {
      // P0.1: Terminal lifecycle detection is a genuine VS Code observation.
      evidence.push({
        type: 'command_execution',
        sourceType: 'observed',
        adapterId: 'vscode.terminal',
        timestamp: now,
        correlationId: event.waitStateId,
      });
    } else {
      evidence.push({
        type: signal.type as 'lifecycle_event' | 'inactivity',
        sourceType: 'inferred',
        adapterId: 'vscode.heuristic',
        timestamp: now,
        correlationId: event.waitStateId,
      });
    }
  }
  // P0.1: NEVER auto-insert fabricated command_execution evidence. Payment
  // eligibility requires ≥2 observed primary signal TYPES from genuinely
  // independent sources. Without real terminal activity, a heuristic
  // ai_generation cannot become billable by auto-adding a second signal.
  return evidence;
}

export function deactivate() {
  // Cleanup is handled via context.subscriptions
}
