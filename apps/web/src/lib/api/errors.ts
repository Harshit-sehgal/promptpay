export function getErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    response?: { data?: { message?: unknown } };
    message?: unknown;
  };
  const message = candidate.response?.data?.message ?? candidate.message;

  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string') return message;
  return fallback;
}
