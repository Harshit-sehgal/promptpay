import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class AdPanel {
  private panel?: vscode.WebviewPanel;
  private onComplete?: (clicked: boolean) => void;
  // One-shot guard. The dispose handler races with the click handler — VS Code may
  // dispose the panel after a click has already fired (or vice versa). Without this
  // flag, `recordClick` and `recordImpressionEnd` would each fire twice and the
  // server would return idempotency-rejected duplicates (or, worse, ledger drift).
  private completed = false;

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
    this.completed = false;

    this.panel = vscode.window.createWebviewPanel(
      'waitlayerAd',
      'WaitLayer ad',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    const ctaUri = safeExternalUri(ad.ctaUrl);

    this.panel.webview.html = renderHtml(ad, this.panel.webview, Boolean(ctaUri));
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'click') {
        if (ctaUri) {
          vscode.env.openExternal(ctaUri);
        }
        this.fireComplete(true);
      }
    });
    this.panel.onDidDispose(() => {
      this.fireComplete(false);
    });
  }

  /** Dispatch the completion callback at most once. Subsequent calls (from a
   *  racing dispose handler, repeated click events, etc.) are ignored. */
  private fireComplete(clicked: boolean): void {
    if (this.completed) return;
    this.completed = true;
    this.onComplete?.(clicked);
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

function nonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

function safeExternalUri(url: string): vscode.Uri | null {
  try {
    const uri = vscode.Uri.parse(url);
    if (uri.scheme === 'https' || uri.scheme === 'http') return uri;
  } catch {
    /* invalid advertiser URL */
  }
  return null;
}

function renderHtml(
  ad: {
    headline: string;
    message: string;
    ctaText: string;
    ctaUrl: string;
  },
  webview: vscode.Webview,
  hasSafeCtaUrl: boolean,
): string {
  const csp = webview.cspSource;
  const styleNonce = nonce();
  const scriptNonce = nonce();

  return `
    <!doctype html>
    <html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; style-src ${csp} 'nonce-${styleNonce}'; script-src 'nonce-${scriptNonce}';">
      <style nonce="${styleNonce}">
        body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #16151d; color: #fff; margin: 0; }
        .ad { background: #1f1d2c; border: 1px solid #2d2b3d; border-radius: 12px; padding: 20px; }
        h2 { margin: 0 0 8px; font-size: 16px; }
        p { margin: 0 0 16px; color: #aaa; font-size: 13px; line-height: 1.5; }
        button { display: inline-block; background: #4f4ce8; color: #fff; padding: 8px 16px; border: 0; border-radius: 8px; text-decoration: none; font-size: 13px; cursor: pointer; }
        button:focus { outline: 2px solid #9b99ff; outline-offset: 2px; }
        .cta-disabled { display: inline-block; color: #aaa; font-size: 13px; }
        .meta { margin-top: 24px; font-size: 11px; color: #555; text-align: center; }
      </style>
    </head>
    <body>
      <div class="ad" id="ad">
        <h2 id="headline"></h2>
        <p id="message"></p>
        ${hasSafeCtaUrl ? `<button id="cta" type="button">${escapeHtml(ad.ctaText)}</button>` : `<span class="cta-disabled">${escapeHtml(ad.ctaText)}</span>`}
      </div>
      <div class="meta">Sponsored — wait state detected</div>
      <script nonce="${scriptNonce}">
        const vscode = acquireVsCodeApi();
        // Use safe DOM text injection — never innerHTML with advertiser content
        document.getElementById('headline').textContent = ${JSON.stringify(ad.headline)};
        document.getElementById('message').textContent = ${JSON.stringify(ad.message)};
        ${hasSafeCtaUrl ? `document.getElementById('cta').addEventListener('click', () => { vscode.postMessage({ type: 'click' }); });` : ''}
      </script>
    </body>
  </html>`;
}
