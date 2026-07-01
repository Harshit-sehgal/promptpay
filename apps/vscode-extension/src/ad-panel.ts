import * as vscode from 'vscode';

export class AdPanel {
  private panel?: vscode.WebviewPanel;
  private onComplete?: (clicked: boolean) => void;

  constructor(
    private context: vscode.ExtensionContext,
    private api: any,
  ) {}

  show(
    ad: {
      headline: string;
      message: string;
      ctaText: string;
      ctaUrl: string;
      impressionId: string;
    },
    onComplete: (clicked: boolean) => void,
  ) {
    this.onComplete = onComplete;

    this.panel = vscode.window.createWebviewPanel(
      'waitlayerAd',
      'WaitLayer ad',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = renderHtml(ad);
    this.panel.onDidDispose(() => {
      this.onComplete?.(false);
    });
  }

  hide() {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

function renderHtml(ad: {
  headline: string;
  message: string;
  ctaText: string;
  ctaUrl: string;
}): string {
  const safe = (s: string) =>
    s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
  return `
    <!doctype html>
    <html><head>
      <style>
        body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #16151d; color: #fff; margin: 0; }
        .ad { background: #1f1d2c; border: 1px solid #2d2b3d; border-radius: 12px; padding: 20px; }
        h2 { margin: 0 0 8px; font-size: 16px; }
        p { margin: 0 0 16px; color: #aaa; font-size: 13px; line-height: 1.5; }
        a { display: inline-block; background: #4f4ce8; color: #fff; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-size: 13px; }
        .meta { margin-top: 24px; font-size: 11px; color: #555; text-align: center; }
      </style>
    </head>
    <body>
      <div class="ad" id="ad">
        <h2>${safe(ad.headline)}</h2>
        <p>${safe(ad.message)}</p>
        <a href="${safe(ad.ctaUrl)}" id="cta">${safe(ad.ctaText)}</a>
      </div>
      <div class="meta">Sponsored — wait state detected</div>
      <script>
        document.getElementById('cta').addEventListener('click', () => {
          if (window.__acquireVsCodeApi) {
            const vs = window.__acquireVsCodeApi();
            vs.postMessage({ type: 'click' });
          }
        });
      </script>
    </body>
  </html>`;
}
