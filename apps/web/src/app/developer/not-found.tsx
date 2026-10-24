import { RouteNotFound } from '@/components/dash';

export default function DeveloperNotFound() {
  return (
    <RouteNotFound href="/developer" actionLabel="Back to dashboard">
      This developer page doesn't exist or has been moved.
    </RouteNotFound>
  );
}
