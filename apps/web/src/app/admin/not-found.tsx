import { RouteNotFound } from '@/components/dash';

export default function AdminNotFound() {
  return (
    <RouteNotFound href="/admin" actionLabel="Back to overview">
      This admin page doesn't exist or has been moved.
    </RouteNotFound>
  );
}
