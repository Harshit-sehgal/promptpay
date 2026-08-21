import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Advertisers — WaitLayer',
  description:
    'Reach developers during their most focused, wait-state moments. Join the advertiser waitlist for founding sponsor access to the WaitLayer private beta.',
};

export default function AdvertisersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
