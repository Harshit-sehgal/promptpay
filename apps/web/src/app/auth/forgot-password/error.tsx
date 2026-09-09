'use client';

import { AuthErrorState } from '@/components/auth-state';

export default function ForgotPasswordError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthErrorState
      reset={reset}
      description="An unexpected error occurred while loading the password reset page."
    />
  );
}
