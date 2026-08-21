import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Advertisers — Ateva',
  description:
    'Reach developers during their most focused, wait-state moments. Join the advertiser waitlist for founding sponsor access to the Ateva private beta.',
};

export default function AdvertisersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
