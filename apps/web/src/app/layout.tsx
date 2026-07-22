import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import ConsentRePrompt from '@/components/consent-reprompt';
import CookieConsent from '@/components/cookie-consent';
import SiteFooter from '@/components/site-footer';
import { SkipLink } from '@/components/skip-link';

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
  title: 'WaitLayer — private beta for AI wait-state verification',
  description:
    'Privacy-first beta for AI wait-state verification. Rewards and advertiser billing remain disabled pending independent attestation. No code tracking.',
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
    title: 'WaitLayer — private beta for AI wait-state verification',
    description:
      'Privacy-first beta for AI wait-state verification. Rewards and advertiser billing remain disabled pending independent attestation.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WaitLayer — private beta for AI wait-state verification',
    description:
      'Privacy-first beta for AI wait-state verification. Rewards and advertiser billing remain disabled pending independent attestation.',
  },
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <SkipLink />
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
