// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { NumberField } from './number-field';

function Harness({
  onCommit,
  min = 1,
  max = 12,
}: {
  onCommit?: (n: number) => void;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(6);
  return (
    <NumberField
      label="Max ads per hour"
      value={value}
      min={min}
      max={max}
      suffix="/ hr"
      hint={`Allowed range ${min}–${max}.`}
      onCommit={(n) => {
        setValue(n);
        onCommit?.(n);
      }}
    />
  );
}

const field = () => screen.getByLabelText('Max ads per hour');

afterEach(() => cleanup());

describe('NumberField', () => {
  it('states the permitted range up front, rather than hiding it', () => {
    render(<Harness />);
    expect(screen.getByText('Allowed range 1–12.')).toBeTruthy();
  });

  it('accepts a typed value inside the range', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '9' } });
    expect(onCommit).toHaveBeenCalledWith(9);
  });

  /**
   * The point of the change: a visitor who types an out-of-range number is told
   * what the limit is, instead of the value being silently altered.
   */
  it('tells the visitor the limit when the typed number is too high', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '40' } });
    expect(screen.getByText(/Enter 1 – 12/)).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('tells the visitor the limit when the typed number is too low', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '0' } });
    expect(screen.getByText(/Enter 1 – 12/)).toBeTruthy();
  });

  it('does not commit an out-of-range value while it is being typed', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '40' } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clamps to the nearest end on blur', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '40' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledWith(12);
  });

  /**
   * Clearing the field to retype must not snap to the minimum mid-edit —
   * that behaviour makes a typed field impossible to actually use.
   */
  it('tolerates an empty field while retyping', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: '11' } });
    expect(onCommit).toHaveBeenCalledWith(11);
  });

  it('restores the committed value when a blank field is blurred', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect((field() as HTMLInputElement).value).toBe('6');
  });
});
