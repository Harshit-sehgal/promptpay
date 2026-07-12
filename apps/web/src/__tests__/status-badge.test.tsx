// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/status-badge';
import { render, screen } from '@testing-library/react';

describe('StatusBadge', () => {
  it('normalizes and displays the status label', () => {
    render(<StatusBadge status="HIGH_TRUST" />);

    expect(screen.getByText('high trust')).toBeTruthy();
  });

  it('applies an emerald style for success-like statuses', () => {
    const { container } = render(<StatusBadge status="active" />);

    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.className).toContain('bg-emerald-50');
  });

  it('falls back to a neutral slate style for unknown statuses', () => {
    const { container } = render(<StatusBadge status="SOMETHING_WEIRD" />);

    const span = container.querySelector('span');
    expect(span?.className).toContain('bg-slate-50');
  });
});
