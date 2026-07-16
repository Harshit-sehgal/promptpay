// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  it('is the keyboard-focusable link to the route-local main landmark', () => {
    render(<SkipLink />);

    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.getAttribute('href')).toBe('#main-content');
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link.className).toContain('focus:translate-y-0');
  });
});
