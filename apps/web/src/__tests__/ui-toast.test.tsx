// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToastProvider, useToast } from '@waitlayer/ui';

function TriggerButton() {
  const { success } = useToast();
  return (
    <button type="button" onClick={() => success('Saved')}>
      Trigger
    </button>
  );
}

describe('ToastProvider / useToast', () => {
  it('shows the message text in a role="status" toast when success() is called', () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Trigger'));

    const toast = screen.getByRole('status');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain('Saved');
  });

  it('throws when useToast is used outside a ToastProvider', () => {
    function BadComponent() {
      useToast();
      return null;
    }

    expect(() => render(<BadComponent />)).toThrow(/useToast must be used within a ToastProvider/);
  });
});
