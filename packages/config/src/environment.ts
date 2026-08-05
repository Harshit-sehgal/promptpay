export const ENVIRONMENT_KINDS = [
  'development',
  'test',
  'sandbox',
  'staging',
  'production',
] as const;

export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export function isProductionEnvironment(kind: EnvironmentKind): boolean {
  return kind === 'production';
}

export function isSandboxEnvironment(kind: EnvironmentKind): boolean {
  return kind === 'sandbox';
}

export function canUseStagingFaucet(kind: EnvironmentKind): boolean {
  return kind === 'test' || kind === 'sandbox' || kind === 'staging';
}
