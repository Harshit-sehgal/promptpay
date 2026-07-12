// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LoadingSpinner } from '@/components/loading-spinner';
import { render, screen } from '@testing-library/react';

describe('LoadingSpinner', () => {
  it('renders a busy status region by default', () => {
    render(<LoadingSpinner />);

    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('renders a size-specific screen-reader label', () => {
    render(<LoadingSpinner size="lg" />);

    expect(screen.getByText(/page, please wait/i)).toBeTruthy();
  });

  it('renders the small label for the sm size', () => {
    render(<LoadingSpinner size="sm" />);

    expect(screen.getByText(/loading content/i)).toBeTruthy();
  });
});
