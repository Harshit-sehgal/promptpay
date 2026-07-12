import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

/** Shared, mutable VS Code mock state (see config.test.ts for the hoist rationale). */
const mock = vi.hoisted(() => ({
  created: [] as Array<{ alignment: number; priority: number }>,
  item: {
    text: '',
    tooltip: '',
    command: '',
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn((alignment: number, priority: number) => {
      mock.created.push({ alignment, priority });
      return mock.item;
    }),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
}));

import { StatusBar } from '../src/status-bar';

function makeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

afterEach(() => {
  mock.created.length = 0;
  mock.item.text = '';
  mock.item.tooltip = '';
  mock.item.command = '';
  mock.item.show.mockClear();
  mock.item.dispose.mockClear();
  vi.restoreAllMocks();
});

describe('StatusBar — registration', () => {
  it('creates a right-aligned item at priority 50 and shows it on register', () => {
    const bar = new StatusBar();
    const context = makeContext();

    bar.register(context);

    expect(mock.created).toHaveLength(1);
    expect(mock.created[0].alignment).toBe(vscode.StatusBarAlignment.Right);
    expect(mock.created[0].priority).toBe(50);
    expect(mock.item.show).toHaveBeenCalledTimes(1);
    expect(context.subscriptions).toContain(mock.item);
    expect(mock.item.text).toBe('$(zap) WaitLayer: idle');
    expect(mock.item.tooltip).toBe('WaitLayer click to view earnings');
    expect(mock.item.command).toBe('waitlayer.showEarnings');
  });
});

describe('StatusBar — state updates', () => {
  it('shows the ad-serving text', () => {
    const bar = new StatusBar();
    bar.register(makeContext());

    bar.showAdServing();
    expect(mock.item.text).toBe('$(zap) WaitLayer: showing ad');
  });

  it('shows the idle text', () => {
    const bar = new StatusBar();
    bar.register(makeContext());

    bar.showAdServing();
    bar.showIdle();
    expect(mock.item.text).toBe('$(zap) WaitLayer: idle');
  });

  it('formats earnings as a dollar amount and updates the tooltip', () => {
    const bar = new StatusBar();
    bar.register(makeContext());

    bar.setEarnings(1250, 'USD');
    expect(mock.item.text).toBe('$(zap) WaitLayer: $12.50');
    expect(mock.item.tooltip).toBe('Click for balance details');
  });

  it('shows the logged-out state and switches the command to login', () => {
    const bar = new StatusBar();
    bar.register(makeContext());

    bar.setLoggedOut();
    expect(mock.item.text).toBe('$(zap) WaitLayer: logged out');
    expect(mock.item.command).toBe('waitlayer.login');
  });

  it('is a no-op before registration (no created item)', () => {
    const bar = new StatusBar();

    expect(() => bar.showIdle()).not.toThrow();
    expect(() => bar.setEarnings(1)).not.toThrow();
    expect(mock.created).toHaveLength(0);
  });
});
