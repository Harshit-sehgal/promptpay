import { CloseSection } from '@/components/home/close-section';
import { Hero } from '@/components/home/hero';
import { HomeHeader } from '@/components/home/home-header';
import { PrivacyLedger } from '@/components/home/privacy-ledger';
import { SponsorsSection } from '@/components/home/sponsors-section';
import { WaitTimeline } from '@/components/home/wait-timeline';

export default function HomePage() {
  return (
    <div className="home-page">
      <HomeHeader />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <WaitTimeline />
        <PrivacyLedger />
        <SponsorsSection />
        <CloseSection />
      </main>
    </div>
  );
}
