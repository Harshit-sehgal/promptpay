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
      impressionToken: string;
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

    this.panel.webview.html = renderHtml(ad, this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'click') {
        this.onComplete?.(true);
      }
    });
    this.panel.onDidDispose(() => {
      this.onComplete?.(false);
    });
  }

  hide() {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(
  ad: {
    headline: string;
    message: string;
    ctaText: string;
    ctaUrl: string;
  },
  webview: vscode.Webview,
): string {
  const csp = webview.cspSource;
  const safeCtaUrl = escapeHtml(ad.ctaUrl);
  const isSafeUrl = /^https?:\/\//i.test(ad.ctaUrl);

  return `
    <!doctype html>
    <html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
      <style>
        body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #16151d; color: #fff; margin: 0; }
        .ad { background: #1f1d2c; border: 1px solid #2d2b3d; border-radius: 12px; padding: 20px; }
        h2 { margin: 0 0 8px; font-size: 16px; }
        p { margin: 0 0 16px; color: #aaa; font-size: 13px; line-height: 1.5; }
        a { display: inline-block; background: #4f4ce8; color: #fff; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-size: 13px; cursor: pointer; }
        .meta { margin-top: 24px; font-size: 11px; color: #555; text-align: center; }
      </style>
    </head>
    <body>
      <div class="ad" id="ad">
        <h2 id="headline"></h2>
        <p id="message"></p>
        ${isSafeUrl ? `<a id="cta" href="${safeCtaUrl}" target="_blank">${escapeHtml(ad.ctaText)}</a>` : `<span class="cta">${escapeHtml(ad.ctaText)}</span>`}
      </div>
      <div class="meta">Sponsored — wait state detected</div>
      <script>
        const vscode = acquireVsCodeApi();
        // Use safe DOM text injection — never innerHTML with advertiser content
        document.getElementById('headline').textContent = ${JSON.stringify(ad.headline)};
        document.getElementById('message').textContent = ${JSON.stringify(ad.message)};
        ${isSafeUrl ? `document.getElementById('cta').addEventListener('click', () => { vscode.postMessage({ type: 'click' }); });` : ''}
      </script>
    </body>
  </html>`;
}
