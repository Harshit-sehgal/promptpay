'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';

import { ToastProvider } from '@waitlayer/ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
