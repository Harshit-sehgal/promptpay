import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { formatMinorUnits } from '@waitlayer/shared';

import { ctaTextForAd } from './ad-display';
import { AdPanel } from './ad-panel';
import { ApiClient } from './api-client';
import { ConfigurationManager } from './config';
import { StatusBar } from './status-bar';
import { WaitStateDetector } from './wait-detector';

export function activate(context: vscode.ExtensionContext) {
  const config = new ConfigurationManager(context.secrets);
  const api = new ApiClient(config);
  const detector = new WaitStateDetector({
    getInactivityTimeoutMs: () => config.getInactivityTimeoutMs(),
  });
  const panel = new AdPanel(context, api);
  const status = new StatusBar();

  // Register status bar
  status.register(context);

  // Frequency cap tracking
  let adTimestamps: number[] = [];
  const sessionId = crypto.randomUUID();
  let activeWaitStateId: string | null = null;

  // Register all commands
  const commands: vscode.Disposable[] = [
    vscode.commands.registerCommand('waitlayer.login', () => api.promptLogin()),
    vscode.commands.registerCommand('waitlayer.logout', () => api.logout()),
    vscode.commands.registerCommand('waitlayer.showEarnings', async () => {
      try {
        const bal = await api.getBalance();
        vscode.window.showInformationMessage(
          `WaitLayer: ${formatMinorUnits(BigInt(bal.available.amountMinor), bal.available.currency)} available (pending ${formatMinorUnits(BigInt(bal.pending.amountMinor), bal.pending.currency)})`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: failed to fetch balance — ${msg}`);
        vscode.window.showErrorMessage(`WaitLayer: failed to fetch balance`);
      }
    }),
    vscode.commands.registerCommand('waitlayer.toggleAds', async () => {
      const enabled = await config.toggleAds();
      vscode.window.showInformationMessage(`WaitLayer: ads ${enabled ? 'enabled' : 'disabled'}`);
    }),
    vscode.commands.registerCommand('waitlayer.openDashboard', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://waitlayer.com/developer'));
    }),
  ];

  // Wait-state detection — fires when AI assistant shows waiting indicator
  detector.onSignal(async (signal) => {
    if (signal.type === 'wait_start') {
      const event = signal.event;
      activeWaitStateId = event.waitStateId;

      let deviceId: string;
      try {
        // 1. Get or register device (obtains UUID)
        deviceId = await api.getOrRegisterDevice();
        const idempotencyKey = `ws-start-${event.waitStateId}`;

        // 2. Register wait state start with API
        await api.waitStateStart({
          deviceId,
          sessionId,
          waitStateId: event.waitStateId,
          toolType: 'vscode',
          idempotencyKey,
        });
      } catch (err: unknown) {
        activeWaitStateId = null;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`WaitLayer: failed to record wait state start — ${msg}`);
        return; // If we can't record the start, we can't do anything else.
      }

      // Decouple ad request and display from wait start recording
      try {
        if (!(await config.adsEnabled())) return;
        if (await config.inQuietHours()) return;

        // Enforce frequency cap
        const maxAdsPerHour = await config.getMaxAdsPerHour();
        const now = Date.now();
        adTimestamps = adTimestamps.filter((t) => now - t < 3600_000);
        if (adTimestamps.length >= maxAdsPerHour) {
          console.warn('WaitLayer: frequency cap reached, skipping ad');
          return;
        }

        // 3. Request an ad
        const ad = await api.requestAd({
          deviceId,
          sessionId,
          waitStateId: event.waitStateId,
          toolType: 'vscode',
          idempotencyKey: `ad-req-${event.waitStateId}`,
        });

        if (ad) {
          adTimestamps.push(now);
          status.showAdServing();

          // 4. Record that the ad was rendered to the user
          await api.recordAdRendered({
            impressionToken: ad.impressionToken,
            renderedAt: new Date().toISOString(),
            idempotencyKey: `render-${ad.impressionToken}`,
          });

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
                // Always qualify first — CPM bills here; CPC uses qualifiedAt as a gate.
                const visibleDurationMs = Math.max(0, Date.now() - impressionShownAt);
                await api.recordImpressionEnd(ad.impressionToken, visibleDurationMs);
                if (clicked) {
                  await api.recordClick(ad.impressionToken);
                }
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
        try {
          await api.waitStateEnd({
            waitStateId: event.waitStateId,
            durationSeconds: Math.floor(event.durationMs / 1000),
            idempotencyKey: `ws-end-${event.waitStateId}`,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`WaitLayer: failed to record wait state end — ${msg}`);
        } finally {
          panel.hide();
          status.showIdle();
        }
      }
    }
  });

  detector.start(context);

  context.subscriptions.push(...commands);

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
        status.setEarnings(bal.available.amountMinor, bal.available.currency);
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

export function deactivate() {
  // Cleanup is handled via context.subscriptions
}
