import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
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

const themeBootstrapScript = `
(() => {
  try {
    const stored = window.localStorage.getItem('ateva-landing-theme');
    const resolved = stored === 'dark' || stored === 'light' ? stored : 'light';
    if (resolved) {
      document.documentElement.dataset.landingTheme = resolved;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    }
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.dataset.landingMotion = 'enabled';
    }
  } catch {
    document.documentElement.dataset.landingTheme = 'light';
    document.documentElement.classList.remove('dark');
  }
})();
`;

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
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased">
        <Script id="ateva-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
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
