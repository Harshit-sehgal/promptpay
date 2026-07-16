// @vitest-environment jsdom
import { type ComponentType, createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import AdminLayout from './admin/layout';
import AdvertiserLayout from './advertiser/layout';
import DeveloperLayout from './developer/layout';

vi.mock('@/components/protected-route', () => ({
  ProtectedRoute: ({ children }: PropsWithChildren) => children,
}));

vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav aria-label="Dashboard navigation" />,
}));

afterEach(() => cleanup());

describe.each([
  ['admin', AdminLayout],
  ['advertiser', AdvertiserLayout],
  ['developer', DeveloperLayout],
] as Array<[string, ComponentType<PropsWithChildren>]>)('%s dashboard layout', (_name, Layout) => {
  it('places its main-content target after dashboard navigation', () => {
    const { container } = render(createElement(Layout, null, <button>Page action</button>));
    const navigation = container.querySelector('nav');
    const main = container.querySelector('main#main-content');

    expect(navigation).not.toBeNull();
    expect(main).not.toBeNull();
    expect(navigation?.compareDocumentPosition(main as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
