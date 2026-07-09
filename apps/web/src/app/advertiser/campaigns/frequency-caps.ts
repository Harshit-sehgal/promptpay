export interface FrequencyCapLimit {
  label: string;
  min: number;
  max: number;
}

export const FREQUENCY_CAPS = {
  perHour: { label: 'Frequency cap per hour', min: 1, max: 30 },
  perDay: { label: 'Frequency cap per day', min: 1, max: 100 },
} satisfies Record<string, FrequencyCapLimit>;

export interface ParsedFrequencyCap {
  value?: number;
  error?: string;
}

export function parseFrequencyCapInput(
  input: string,
  limit: FrequencyCapLimit,
): ParsedFrequencyCap {
  const trimmed = input.trim();
  if (!trimmed) return {};

  if (!/^\d+$/.test(trimmed)) {
    return { error: `${limit.label} must be a whole number from ${limit.min} to ${limit.max}.` };
  }

  const value = Number(trimmed);
  if (value < limit.min || value > limit.max) {
    return { error: `${limit.label} must be between ${limit.min} and ${limit.max}.` };
  }

  return { value };
}

export function frequencyCapValueToInput(value?: number | null): string {
  return typeof value === 'number' ? String(value) : '';
}
