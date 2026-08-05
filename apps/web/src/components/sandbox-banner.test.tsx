// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import SandboxBanner from './sandbox-banner';

describe('SandboxBanner (WL-013)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders unmistakable no-cash-value copy when the server-verified mode is sandbox', () => {
    render(<SandboxBanner environmentKind="sandbox" />);
    expect(screen.getByRole('status', { name: 'Sandbox environment' }).textContent).toContain(
      'SANDBOX · Test credits only · No cash value',
    );
  });

  it('renders nothing for production or development environments', () => {
    const { unmount } = render(<SandboxBanner environmentKind="production" />);
    expect(screen.queryByRole('status')).toBeNull();
    unmount();

    render(<SandboxBanner environmentKind="development" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
