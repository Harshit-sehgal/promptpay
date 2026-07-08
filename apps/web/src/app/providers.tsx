'use client';

import { AuthProvider } from '@/lib/auth-context';
import { ToastProvider } from '@waitlayer/ui';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
