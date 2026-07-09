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
