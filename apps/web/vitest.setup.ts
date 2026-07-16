// Tests must run under a non-production NODE_ENV:
//  - React only exports `act` (required by @testing-library/react) from its
//    development build, which is selected when NODE_ENV !== 'production'.
//  - The auth-cookie `isSecure()` heuristic and the shared config validator
//    apply production-only rules under NODE_ENV=production.
// The parent shell may export NODE_ENV=production from a prior `next build`;
// force a test environment so the suite is deterministic regardless.
(process.env as { NODE_ENV?: string }).NODE_ENV = 'test';
