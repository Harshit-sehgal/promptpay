import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import ConsentRePrompt from '@/components/consent-reprompt';
import CookieConsent from '@/components/cookie-consent';
import SandboxBanner from '@/components/sandbox-banner';
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

const instrumentSerif = localFont({
  src: [
    { path: '../../public/fonts/instrument-serif-400.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/instrument-serif-400-italic.ttf', weight: '400', style: 'italic' },
  ],
  variable: '--font-serif',
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'https://ateva.vercel.app'),
  title: 'Ateva — private beta for AI wait-state verification',
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
    siteName: 'Ateva',
    title: 'Ateva — private beta for AI wait-state verification',
    description:
      'Privacy-first beta for AI wait-state verification. Rewards and advertiser billing remain disabled pending independent attestation.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ateva — private beta for AI wait-state verification',
    description:
      'Privacy-first beta for AI wait-state verification. Rewards and advertiser billing remain disabled pending independent attestation.',
  },
  icons: {
    icon: '/favicon.svg',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased">
        <SkipLink />
        <SandboxBanner />
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
