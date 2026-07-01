import './globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'WaitLayer — Earn from AI wait time',
  description: 'Privacy-first reward marketplace for AI coding assistant wait states. PayPal-first payouts. Transparent earnings. No code tracking.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
