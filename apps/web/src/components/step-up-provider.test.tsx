// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getStepUpPrompt } from '@/lib/api/step-up';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { StepUpProvider } from './step-up-provider';

describe('StepUpProvider', () => {
  afterEach(() => cleanup());

  it('returns a canonical backup code without stripping its separators', async () => {
    render(
      <StepUpProvider>
        <div>Protected page</div>
      </StepUpProvider>,
    );

    let response!: Promise<string | null>;
    act(() => {
      response = getStepUpPrompt()!('account:delete');
    });

    const input = screen.getByLabelText('Two-factor authentication code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abcd-efgh-jkmn' } });
    expect(input.value).toBe('ABCD-EFGH-JKMN');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await expect(response).resolves.toBe('ABCD-EFGH-JKMN');
  });

  it('accepts a six-digit TOTP and rejects malformed values', () => {
    render(
      <StepUpProvider>
        <div>Protected page</div>
      </StepUpProvider>,
    );

    act(() => {
      void getStepUpPrompt()!('payout:request');
    });
    const input = screen.getByLabelText('Two-factor authentication code');
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: '12345' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '123456' } });
    expect(confirm.disabled).toBe(false);
  });

  it('settles an older prompt instead of leaving its request hanging', async () => {
    render(
      <StepUpProvider>
        <div>Protected page</div>
      </StepUpProvider>,
    );

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = getStepUpPrompt()!('payout:request');
      second = getStepUpPrompt()!('account:delete');
    });

    await expect(first).resolves.toBeNull();
    expect(screen.getByText(/permanently delete this account/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(second).resolves.toBeNull();
  });
});
