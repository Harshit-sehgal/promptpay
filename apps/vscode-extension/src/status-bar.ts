import * as vscode from 'vscode';

import { formatMinorUnits } from '@waitlayer/shared';

export class StatusBar {
  private bar?: vscode.StatusBarItem;
  private sandbox = false;
  private environmentMismatch = false;

  register(context: vscode.ExtensionContext, environmentKind = 'production') {
    this.sandbox = environmentKind === 'sandbox';
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.setLoggedIn();
    this.bar.show();
    context.subscriptions.push(this.bar);
  }

  showAdServing() {
    if (this.bar) {
      this.bar.text = this.environmentMismatch ? this.mismatchLabel() : this.label('showing ad');
    }
  }

  showEnvironmentMismatch(clientKind: string, serverKind: string): void {
    this.environmentMismatch = true;
    if (!this.bar) return;
    this.bar.text = '$(warning) WaitLayer: ENVIRONMENT MISMATCH';
    this.bar.tooltip = `Environment mismatch: client=${clientKind}, server=${serverKind}. Check the API URL and environment setting.`;
    this.bar.command = 'waitlayer.openDashboard';
  }

  showRewardsUnavailable() {
    if (this.bar) {
      this.bar.text = this.environmentMismatch
        ? this.mismatchLabel()
        : this.sandbox
        ? '$(info) WaitLayer [SANDBOX]: test credits only'
        : '$(info) WaitLayer: rewards unavailable';
      this.bar.tooltip = this.environmentMismatch
        ? 'Environment mismatch: check the API URL and environment setting.'
        : this.sandbox
          ? 'Sandbox: test credits only; no cash value.'
          : 'Wait detected. Rewards are not enabled in this launch mode.';
      this.bar.command = 'waitlayer.showEarnings';
    }
  }

  showIdle() {
    this.setLoggedIn();
  }

  isEnvironmentVerified(): boolean {
    return !this.environmentMismatch;
  }

  setLoggedIn() {
    if (!this.bar) return;
    this.bar.text = this.environmentMismatch ? this.mismatchLabel() : this.label('idle');
    this.bar.tooltip = this.sandbox
      ? 'Sandbox: test credits only; no cash value. Click for details.'
      : 'WaitLayer click to view earnings';
    this.bar.command = 'waitlayer.showEarnings';
  }

  /**
   * Display available balance in the status bar. Formats minor units using
   * the per-currency exponent (e.g. /100 for USD, /1 for JPY, /1000 for BHD)
   * so zero-decimal and 3-decimal currencies render correctly.
   */
  setEarnings(amountMinor: bigint, currency: string) {
    if (this.bar) {
      this.bar.text = this.environmentMismatch
        ? this.mismatchLabel()
        : this.sandbox
        ? `$(zap) WaitLayer [SANDBOX]: ${formatMinorUnits(amountMinor, currency)}`
        : `$(zap) WaitLayer: ${formatMinorUnits(amountMinor, currency)}`;
      this.bar.tooltip = this.sandbox
        ? `Sandbox test credits only; no cash value. Click for balance details.`
        : `Click for balance details`;
      this.bar.command = 'waitlayer.showEarnings';
    }
  }

  setLoggedOut() {
    if (this.bar) {
      this.bar.text = this.environmentMismatch ? this.mismatchLabel() : this.label('logged out');
      this.bar.tooltip = this.sandbox ? 'Sandbox environment — log in for test credits.' : 'Log in to WaitLayer';
      this.bar.command = 'waitlayer.login';
    }
  }

  private label(state: string): string {
    return this.sandbox ? `$(zap) WaitLayer [SANDBOX]: ${state}` : `$(zap) WaitLayer: ${state}`;
  }

  private mismatchLabel(): string {
    return '$(warning) WaitLayer: ENVIRONMENT MISMATCH';
  }
}
