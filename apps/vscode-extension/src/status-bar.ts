import * as vscode from 'vscode';

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

  setEarnings(available: number) {
    if (this.bar) {
      this.bar.text = `$(zap) WaitLayer: $${available.toFixed(2)}`;
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
