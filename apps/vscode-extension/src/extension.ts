import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConfigurationManager } from './config';
import { WaitStateDetector } from './wait-detector';
import { ApiClient } from './api-client';
import { AdPanel } from './ad-panel';
import { StatusBar } from './status-bar';

export function activate(context: vscode.ExtensionContext) {
  const config = new ConfigurationManager();
  const api = new ApiClient(config);
  const detector = new WaitStateDetector();
  const panel = new AdPanel(context, api);
  const status = new StatusBar();

  // Register status bar
  status.register(context);

  // Frequency cap tracking
  let adTimestamps: number[] = [];
  let sessionId = crypto.randomUUID();

  // Register all commands
  const commands: vscode.Disposable[] = [
    vscode.commands.registerCommand('waitlayer.login', () => api.promptLogin()),
    vscode.commands.registerCommand('waitlayer.logout', () => api.logout()),
    vscode.commands.registerCommand('waitlayer.showEarnings', async () => {
      try {
        const bal = await api.getBalance();
        vscode.window.showInformationMessage(
          `WaitLayer: $${(bal.availableMinor / 100).toFixed(2)} available (pending $${(bal.pendingMinor / 100).toFixed(2)})`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`WaitLayer: failed to fetch balance`);
      }
    }),
    vscode.commands.registerCommand('waitlayer.toggleAds', async () => {
      const enabled = await config.toggleAds();
      vscode.window.showInformationMessage(
        `WaitLayer: ads ${enabled ? 'enabled' : 'disabled'}`,
      );
    }),
    vscode.commands.registerCommand('waitlayer.openDashboard', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://waitlayer.com/developer'));
    }),
  ];

  // Wait-state detection — fires when AI assistant shows waiting indicator
  detector.onWaitStateStart(async (event) => {
    if (!(await config.adsEnabled())) return;
    if (await config.inQuietHours()) return;

    // Enforce frequency cap
    const maxAdsPerHour = await config.getMaxAdsPerHour();
    const now = Date.now();
    adTimestamps = adTimestamps.filter((t) => now - t < 3600_000);
    if (adTimestamps.length >= maxAdsPerHour) {
      console.log('WaitLayer: frequency cap reached, skipping ad');
      return;
    }

    try {
      // 1. Register wait state start with API
      const deviceId = await config.getDeviceFingerprint();
      const idempotencyKey = `ws-start-${event.waitStateId}`;
      await api.waitStateStart({
        deviceId,
        waitStateId: event.waitStateId,
        toolType: 'vscode',
        idempotencyKey,
      });

      // 2. Request an ad
      const ad = await api.requestAd({
        toolType: 'vscode',
        waitDurationMs: event.durationMs,
        deviceFingerprint: deviceId,
      });

      if (ad) {
        adTimestamps.push(now);
        status.showAdServing();
        panel.show(ad, async (clicked) => {
          if (clicked) {
            await api.recordClick(ad.impressionToken);
          }
          await api.recordImpressionEnd(ad.impressionToken, 5000);
          panel.hide();
          status.showIdle();
        });
      }
    } catch (err) {
      // Silent fail — never disrupt the IDE
      console.warn('WaitLayer: ad request failed', err);
    }
  });

  detector.start(context);

  context.subscriptions.push(...commands);

  // Boot message
  api
    .getBalance()
    .then((bal) => {
      status.setEarnings(bal.availableMinor / 100);
    })
    .catch(() => {
      status.setLoggedOut();
    });
}

export function deactivate() {
  // Cleanup is handled via context.subscriptions
}
