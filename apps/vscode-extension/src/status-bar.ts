import * as vscode from 'vscode';

import { formatMinorUnits } from '@waitlayer/shared';

export class StatusBar {
  private bar?: vscode.StatusBarItem;

  register(context: vscode.ExtensionContext) {
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.bar.text = '$(zap) WaitLayer: idle';
    this.bar.tooltip = 'WaitLayer click to view earnings';
    this.bar.command = 'waitlayer.showEarnings';
    this.bar.show();
    context.subscriptions.push(this.bar);
  }

  showAdServing() {
    if (this.bar) {
      this.bar.text = '$(zap) WaitLayer: showing ad';
    }
  }

  showIdle() {
    if (this.bar) {
      this.bar.text = '$(zap) WaitLayer: idle';
    }
  }

  /**
   * Display available balance in the status bar. Formats minor units using
   * the per-currency exponent (e.g. /100 for USD, /1 for JPY, /1000 for BHD)
   * so zero-decimal and 3-decimal currencies render correctly.
   */
  setEarnings(amountMinor: number, currency: string) {
    if (this.bar) {
      this.bar.text = `$(zap) WaitLayer: ${formatMinorUnits(BigInt(amountMinor), currency)}`;
      this.bar.tooltip = `Click for balance details`;
    }
  }

  setLoggedOut() {
    if (this.bar) {
      this.bar.text = '$(zap) WaitLayer: logged out';
      this.bar.command = 'waitlayer.login';
    }
  }
}
