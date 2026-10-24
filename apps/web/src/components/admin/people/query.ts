import { isValidTag } from './tags';
import { type PeopleQuery, type PeopleTab, WAITLIST_STATUSES } from './types';

const ROLES = ['developer', 'advertiser', 'admin', 'super_admin', 'support'];
const USER_STATUSES = ['active', 'restricted', 'banned', 'deleted'];
const VERIFIED = ['email', 'unverified'];

export const EMPTY_QUERY: PeopleQuery = {
  tab: 'registered',
  q: '',
  role: '',
  status: '',
  country: '',
  verified: '',
  tag: '',
  page: 1,
};

function oneOf(value: string | null, allowed: string[]): string {
  return value && allowed.includes(value) ? value : '';
}

/** Reads the shareable view out of the URL, ignoring anything it does not recognise. */
export function parseQuery(params: Pick<URLSearchParams, 'get'> | null): PeopleQuery {
  if (!params) return EMPTY_QUERY;
  const tab: PeopleTab = params.get('tab') === 'waitlist' ? 'waitlist' : 'registered';
  const page = Number.parseInt(params.get('page') ?? '', 10);
  const country = (params.get('country') ?? '').toUpperCase();
  const tag = params.get('tag') ?? '';
  return {
    tab,
    q: params.get('q') ?? '',
    role: tab === 'registered' ? oneOf(params.get('role'), ROLES) : '',
    status: oneOf(params.get('status'), tab === 'registered' ? USER_STATUSES : WAITLIST_STATUSES),
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    verified: tab === 'registered' ? oneOf(params.get('verified'), VERIFIED) : '',
    tag: isValidTag(tag) ? tag : '',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function serialiseQuery(query: PeopleQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== 'registered') params.set('tab', query.tab);
  for (const key of ['q', 'role', 'status', 'country', 'verified', 'tag'] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  if (query.page > 1) params.set('page', String(query.page));
  return params.toString();
}
