export type SignupRole = 'developer' | 'advertiser';

export interface SignupIntent {
  role: SignupRole;
  referrerCode: string;
}

export function getDashboardPath(role: string | null | undefined): string {
  switch (role) {
    case 'advertiser':
      return '/advertiser';
    case 'admin':
    case 'super_admin':
      return '/admin';
    default:
      return '/developer';
  }
}

/** Resolve a post-login destination without allowing open redirects or cross-role navigation. */
export function resolvePostLoginPath(
  role: string | null | undefined,
  requestedPath: string | null | undefined,
): string {
  const dashboardPath = getDashboardPath(role);
  if (!requestedPath || !requestedPath.startsWith('/') || requestedPath.startsWith('//')) {
    return dashboardPath;
  }

  try {
    const base = new URL('https://waitlayer.local');
    const candidate = new URL(requestedPath, base);
    if (candidate.origin !== base.origin) return dashboardPath;
    if (
      candidate.pathname !== dashboardPath &&
      !candidate.pathname.startsWith(`${dashboardPath}/`)
    ) {
      return dashboardPath;
    }
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return dashboardPath;
  }
}

export function resolveSignupIntent(search: string | URLSearchParams): SignupIntent {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const referrerCode = params.get('ref')?.trim();

  if (referrerCode) {
    return {
      role: 'developer',
      referrerCode: referrerCode.toUpperCase(),
    };
  }

  const role = params.get('role');
  return {
    role: role === 'advertiser' || role === 'developer' ? role : 'developer',
    referrerCode: '',
  };
}
