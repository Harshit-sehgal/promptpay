import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import ConsentRePrompt from '@/components/consent-reprompt';
import CookieConsent from '@/components/cookie-consent';
import SiteFooter from '@/components/site-footer';

import { Providers } from './providers';

const inter = localFont({
  src: [
    { path: '../../public/fonts/inter-400.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/inter-500.ttf', weight: '500', style: 'normal' },
    { path: '../../public/fonts/inter-600.ttf', weight: '600', style: 'normal' },
    { path: '../../public/fonts/inter-700.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = localFont({
  src: [
    { path: '../../public/fonts/jetbrains-mono-400.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/jetbrains-mono-500.ttf', weight: '500', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'https://waitlayer.com'),
  title: 'WaitLayer — Earn from AI wait time',
  description:
    'Privacy-first reward marketplace for AI coding assistant wait states. PayPal-first payouts. Transparent earnings. No code tracking.',
  keywords: [
    'AI wait time',
    'developer earnings',
    'developer ads',
    'privacy-first ads',
    'paypal payouts',
  ],
  openGraph: {
    type: 'website',
    siteName: 'WaitLayer',
    title: 'WaitLayer — Earn from AI wait time',
    description:
      'Privacy-first reward marketplace for AI coding assistant wait states. Transparent earnings, PayPal-first payouts.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WaitLayer — Earn from AI wait time',
    description:
      'Privacy-first reward marketplace for AI coding assistant wait states. Transparent earnings, PayPal-first payouts.',
  },
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          <SiteFooter />
          <CookieConsent />
          <ConsentRePrompt />
        </Providers>
      </body>
    </html>
  );
}
