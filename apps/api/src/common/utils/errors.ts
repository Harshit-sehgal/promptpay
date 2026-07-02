export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : fallback;
}

export function getErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}
