import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import ConsentRePrompt from '@/components/consent-reprompt';
import CookieConsent from '@/components/cookie-consent';
import SandboxBanner from '@/components/sandbox-banner';
import SiteFooter from '@/components/site-footer';
import { SkipLink } from '@/components/skip-link';
import { paletteBootstrapScript } from '@/lib/palette';

import { Providers } from './providers';

const interTight = localFont({
  src: [{ path: '../../public/fonts/inter-tight-var.ttf', weight: '100 900', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const geist = localFont({
  src: [{ path: '../../public/fonts/geist-var.ttf', weight: '100 900', style: 'normal' }],
  variable: '--font-ui',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const geistMono = localFont({
  src: [{ path: '../../public/fonts/geist-mono-var.ttf', weight: '100 900', style: 'normal' }],
  variable: '--font-utility',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'https://ateva.vercel.app'),
  title: 'Ateva — delivery verification for AI-agent apps',
  description:
    'Ateva gives integrated AI-agent apps a clearly labelled sponsor surface during eligible waits and verifies delivery. Private beta; rewards and campaign billing remain disabled.',
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
    title: 'Ateva — delivery verification for AI-agent apps',
    description:
      'Clearly labelled sponsor surfaces for eligible waits, with delivery verification and a narrow privacy boundary. Rewards and campaign billing remain disabled in beta.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ateva — delivery verification for AI-agent apps',
    description:
      'Clearly labelled sponsor surfaces for eligible waits, with delivery verification and a narrow privacy boundary. Rewards and campaign billing remain disabled in beta.',
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
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${interTight.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <head>
        {/* A plain inline script in <head> runs before first paint. next/script's
            beforeInteractive is queued until the JS chunks load in the App Router,
            which painted Warm first and then animated to the stored palette. */}
        <script
          id="ateva-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: paletteBootstrapScript }}
        />
      </head>
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
