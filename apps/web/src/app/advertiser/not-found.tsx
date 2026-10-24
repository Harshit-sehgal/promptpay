import { RouteNotFound } from '@/components/dash';

export default function AdvertiserNotFound() {
  return (
    <RouteNotFound href="/advertiser" actionLabel="Back to dashboard">
      This advertiser page doesn't exist or has been moved.
    </RouteNotFound>
  );
}
