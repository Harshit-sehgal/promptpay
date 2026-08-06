'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api/client';

/**
 * Activation path for a newly signed-up developer (A-090).
 *
 * The developer dashboard previously contained zero references to the VS Code
 * extension, the CLI, install commands, or device registration. A developer
 * could complete signup and have no way to discover that anything needed
 * installing — the product's entire supply side depended on a step that was
 * never mentioned anywhere in the product.
 *
 * This panel does one job: get from "account created" to "a client is
 * connected", and prove it happened. It disappears once a device is seen, so
 * it never becomes permanent dashboard furniture.
 */
interface DeviceSummary {
  deviceCount: number;
  hasConnectedDevice: boolean;
  lastSeenAt: string | null;
  devices: Array<{
    id: string;
    toolType: string;
    platform: string | null;
    extensionVersion: string | null;
    lastSeenAt: string;
  }>;
}

// Published install targets. These are intentionally *not* deep links to a
// marketplace listing that does not exist yet: until the clients are published
// (see LAUNCH_PLAN.md), pointing users at a 404 is worse than telling them the
// truth. Flip `CLIENTS_PUBLISHED` when publish-vscode.yml / publish-cli.yml
// have actually shipped an artifact.
const CLIENTS_PUBLISHED = false;
const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=waitlayer.waitlayer';
const CLI_INSTALL = 'npm install -g waitlayer-cli';
const CLI_LOGIN = 'waitlayer login';
const CLI_RUN = 'waitlayer run -- <your AI command>';

function CodeLine({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-950 px-3 py-2">
      <code className="overflow-x-auto whitespace-nowrap text-xs text-surface-100">{children}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(children).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
        className="shrink-0 rounded border border-surface-700 px-2 py-0.5 text-[11px] font-medium text-surface-300 transition-colors hover:bg-surface-800"
        aria-label={`Copy: ${children}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function DeveloperGetStarted() {
  const [summary, setSummary] = useState<DeviceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api
      .get<DeviceSummary>('/developer/devices')
      .then(({ data }) => {
        if (active) setSummary(data);
      })
      .catch(() => {
        // A failed read must not hide the instructions — a developer with no
        // client installed is exactly who needs to see this panel.
        if (active) setSummary(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Avoid flashing "you have nothing set up" at a developer who does.
  if (loading) return null;

  if (summary?.hasConnectedDevice) {
    const newest = summary.devices[0];
    return (
      <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-950">
        <p className="font-semibold">
          {summary.deviceCount === 1
            ? '1 client connected'
            : `${summary.deviceCount} clients connected`}
        </p>
        <p className="mt-1 text-emerald-900/80">
          Most recent: <span className="font-medium">{newest.toolType}</span>
          {newest.platform ? ` on ${newest.platform}` : ''}
          {newest.extensionVersion ? ` · v${newest.extensionVersion}` : ''} · last seen{' '}
          {new Date(newest.lastSeenAt).toLocaleString()}
        </p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="get-started-heading"
      className="mb-8 rounded-2xl border border-brand-200 bg-brand-50/40 p-6"
    >
      <h2 id="get-started-heading" className="text-base font-semibold text-surface-950">
        Get started — connect a client
      </h2>
      <p className="mt-1 text-sm leading-6 text-surface-600">
        Your account is ready, but nothing is reporting yet. WaitLayer detects AI wait states from a
        client running on your machine — install one below, sign in, and this dashboard will start
        showing verified activity.
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-surface-900">VS Code extension</h3>
          <p className="mt-1 text-xs leading-5 text-surface-500">
            Detects wait states in VS Code, Cursor, Windsurf, and Cline.
          </p>
          {CLIENTS_PUBLISHED ? (
            <a
              href={MARKETPLACE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex h-9 items-center rounded-lg bg-surface-950 px-3 text-xs font-medium text-white transition-colors hover:bg-surface-800"
            >
              Install from Marketplace →
            </a>
          ) : (
            <p className="mt-3 rounded-lg bg-surface-100 px-3 py-2 text-xs leading-5 text-surface-600">
              Not yet published to the Marketplace. Build it locally with{' '}
              <code className="text-[11px]">pnpm --filter waitlayer-vscode package</code> and
              install the resulting <code className="text-[11px]">.vsix</code> via{' '}
              <span className="whitespace-nowrap">Extensions → Install from VSIX…</span>
            </p>
          )}
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-surface-900">Command-line tool</h3>
          <p className="mt-1 text-xs leading-5 text-surface-500">
            Supervises any terminal AI tool — Claude Code, Aider, Codex CLI.
          </p>
          <div className="mt-3 space-y-2">
            {CLIENTS_PUBLISHED ? (
              <CodeLine>{CLI_INSTALL}</CodeLine>
            ) : (
              <p className="rounded-lg bg-surface-100 px-3 py-2 text-xs leading-5 text-surface-600">
                Not yet published to npm. Build locally with{' '}
                <code className="text-[11px]">pnpm --filter waitlayer-cli build</code>.
              </p>
            )}
            <CodeLine>{CLI_LOGIN}</CodeLine>
            <CodeLine>{CLI_RUN}</CodeLine>
          </div>
        </div>
      </div>

      <p className="mt-5 text-xs leading-5 text-surface-500">
        Clients send a normalized tool type and lifecycle timing only — never your prompts, command
        arguments, source code, or terminal output.
      </p>
    </section>
  );
}
