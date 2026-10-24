// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery, serialiseQuery } from '@/components/admin/people/query';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import AdminPeoplePage from './page';

let search = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getPeopleSummary: vi.fn(),
    getPeopleUsers: vi.fn(),
    getPeopleUser: vi.fn(),
    getPeopleWaitlist: vi.fn(),
    setWaitlistStatus: vi.fn(),
    exportPeople: vi.fn(),
  },
}));

const summary = {
  users: {
    total: 1234,
    byRole: { developer: 1000, advertiser: 234 },
    byStatus: { active: 1200 },
    emailVerified: 900,
    twoFactorEnabled: 12,
    last7d: 41,
    last30d: 160,
  },
  waitlist: {
    total: 77,
    byStatus: { pending: 50, invited: 20, onboarded: 5, declined: 2 },
    last7d: 9,
    last30d: 30,
  },
  signupsByDay: [
    { date: '2026-10-23', users: 3, waitlist: 0 },
    { date: '2026-10-24', users: 5, waitlist: 2 },
  ],
};

const userRow = {
  id: 'u-1',
  email: 'dev@example.com',
  name: 'Dev Person',
  role: 'developer',
  status: 'active',
  trustLevel: 'normal',
  country: 'IN',
  emailVerified: true,
  googleVerified: false,
  githubVerified: true,
  twoFactorEnabled: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  companyName: null,
  deviceCount: 2,
  lastSeenAt: '2026-10-24T10:00:00.000Z',
};

const userDetail = {
  ...userRow,
  referralCode: 'WAIT-7Q2K',
  updatedAt: '2026-10-20T10:00:00.000Z',
  advertiser: {
    companyName: 'Acme Ads',
    billingEmail: 'bill@acme.test',
    websiteUrl: 'https://acme.test',
    trustStatus: 'verified',
  },
  consents: [
    { purpose: 'analytics', version: '3', granted: true, createdAt: '2026-10-02T10:00:00.000Z' },
  ],
  devices: [
    {
      id: 'd-1',
      toolType: 'vscode',
      platform: 'linux',
      extensionVersion: '1.4.0',
      createdAt: '2026-10-02T10:00:00.000Z',
      lastSeenAt: '2026-10-24T10:00:00.000Z',
    },
  ],
  referredBy: { id: 'u-0', email: 'friend@example.com' },
  referralsMade: 4,
  openFlags: 1,
};

const waitRow = {
  id: 'w-1',
  email: 'sponsor@example.com',
  company: 'Example Co',
  country: 'US',
  status: 'pending' as const,
  consent: true,
  source: 'advertisers_page',
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  registeredUserId: null as string | null,
};

const list = (rows: unknown[], total = rows.length) =>
  ({ data: { rows, total, page: 1, limit: 25 } }) as never;

beforeEach(() => {
  search = '';
  vi.mocked(adminApi.getPeopleSummary).mockResolvedValue({ data: summary } as never);
  vi.mocked(adminApi.getPeopleUsers).mockResolvedValue(list([userRow]));
  vi.mocked(adminApi.getPeopleWaitlist).mockResolvedValue(list([waitRow]));
  vi.mocked(adminApi.getPeopleUser).mockResolvedValue({ data: userDetail } as never);
  window.history.replaceState(null, '', '/admin/people');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminPeoplePage', () => {
  it('shows the summary figures, the chart summary and registered rows', async () => {
    render(<AdminPeoplePage />);

    expect(await screen.findByText('dev@example.com', { exact: false })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('1,234').length).toBeGreaterThan(0));
    expect(screen.getByText('41')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText(/8 registrations and 2 waitlist signups/)).toBeTruthy();
    expect(adminApi.getPeopleUsers).toHaveBeenCalledWith({ page: 1, limit: 25 });
    expect(screen.getByText('Email · GitHub')).toBeTruthy();
  });

  it('passes filters to the API and returns to page one', async () => {
    render(<AdminPeoplePage />);
    await screen.findByText('Dev Person');

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'advertiser' } });

    await waitFor(() =>
      expect(adminApi.getPeopleUsers).toHaveBeenLastCalledWith({
        role: 'advertiser',
        page: 1,
        limit: 25,
      }),
    );
    await waitFor(() => expect(window.location.search).toBe('?role=advertiser'));
  });

  it('opens the detail dialog with every group of fields', async () => {
    render(<AdminPeoplePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dev Person' }));

    const dialog = await screen.findByRole('dialog');
    expect(adminApi.getPeopleUser).toHaveBeenCalledWith('u-1');
    await within(dialog).findByText('WAIT-7Q2K');
    for (const heading of [
      'Identity',
      'Verification',
      'Account',
      'Advertiser',
      'Consents',
      'Devices (2)',
      'Referrals',
    ]) {
      expect(within(dialog).getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(within(dialog).getByText('Acme Ads')).toBeTruthy();
    expect(within(dialog).getByText('bill@acme.test')).toBeTruthy();
    expect(within(dialog).getByText('Analytics')).toBeTruthy();
    expect(within(dialog).getByText('vscode')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'friend@example.com' })).toBeTruthy();
    expect(within(dialog).getByText('4')).toBeTruthy();
  });

  it('shows an error with retry when the list fails', async () => {
    vi.mocked(adminApi.getPeopleUsers).mockRejectedValueOnce(new Error('boom'));
    render(<AdminPeoplePage />);

    const alert = await screen.findByText(/Failed to load registered users|boom/);
    expect(alert).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(await screen.findByText('Dev Person')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    vi.mocked(adminApi.getPeopleUsers).mockResolvedValue(list([]));
    render(<AdminPeoplePage />);
    expect(await screen.findByText('No registered users match these filters.')).toBeTruthy();
  });
});

describe('Waitlist tab', () => {
  beforeEach(() => {
    search = 'tab=waitlist';
  });

  it('renders rows, status counts from the summary and the registered marker', async () => {
    vi.mocked(adminApi.getPeopleWaitlist).mockResolvedValue(
      list([
        waitRow,
        { ...waitRow, id: 'w-2', email: 'joined@example.com', registeredUserId: 'u-1' },
      ]),
    );
    render(<AdminPeoplePage />);

    expect(await screen.findByText('sponsor@example.com')).toBeTruthy();
    expect(adminApi.getPeopleWaitlist).toHaveBeenCalledWith({ page: 1, limit: 25 });
    const statusGroup = screen.getByRole('group', { name: 'Waitlist status' });
    await waitFor(() => expect(within(statusGroup).getByText('50')).toBeTruthy());
    expect(within(statusGroup).getByText('77')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Registered: open joined@example.com' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(adminApi.getPeopleUser).toHaveBeenCalledWith('u-1');
    expect(screen.getAllByText('Not registered')).toHaveLength(1);
  });

  it('filters by status tab', async () => {
    render(<AdminPeoplePage />);
    await screen.findByText('sponsor@example.com');

    fireEvent.click(screen.getByRole('button', { name: /Invited/ }));

    await waitFor(() =>
      expect(adminApi.getPeopleWaitlist).toHaveBeenLastCalledWith({
        status: 'invited',
        page: 1,
        limit: 25,
      }),
    );
  });

  it('changes status optimistically and saves it', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(adminApi.setWaitlistStatus).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );
    render(<AdminPeoplePage />);
    const select = (await screen.findByLabelText(
      'Status for sponsor@example.com',
    )) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'invited' } });

    expect(adminApi.setWaitlistStatus).toHaveBeenCalledWith('w-1', 'invited');
    expect(select.value).toBe('invited');
    expect(select.disabled).toBe(true);

    resolve({ data: { ...waitRow, status: 'invited' } });
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('invited');
    await waitFor(() => expect(adminApi.getPeopleSummary).toHaveBeenCalledTimes(2));
  });

  it('reverts the status and shows an error when saving fails', async () => {
    vi.mocked(adminApi.setWaitlistStatus).mockRejectedValue(new Error('nope'));
    render(<AdminPeoplePage />);
    const select = (await screen.findByLabelText(
      'Status for sponsor@example.com',
    )) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'declined' } });

    await waitFor(() => expect(select.value).toBe('pending'));
    const alert = await screen.findByText(/Could not change sponsor@example.com to declined/);
    expect(alert).toBeTruthy();
    expect(select.disabled).toBe(false);
  });
});

describe('Export', () => {
  it('exports the filtered registered rows as CSV with formula escaping', async () => {
    search = 'role=developer';
    const created: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return 'blob:test';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(adminApi.exportPeople).mockResolvedValue({
      data: { rows: [{ ...userRow, name: '=1+1' }], truncated: false },
    } as never);

    render(<AdminPeoplePage />);
    await screen.findByText('Dev Person');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(adminApi.exportPeople).toHaveBeenCalledWith('users', { role: 'developer' });
    const text = await new Promise<string>((done) => {
      const reader = new FileReader();
      reader.onload = () => done(String(reader.result));
      reader.readAsText(created[0]!);
    });
    expect(text).toContain('"\'=1+1"');
    expect(text).toContain('"dev@example.com"');
  });

  it('warns when the export was truncated', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(adminApi.exportPeople).mockResolvedValue({
      data: { rows: [userRow], truncated: true },
    } as never);

    render(<AdminPeoplePage />);
    await screen.findByText('Dev Person');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText(/stopped at 10,000 rows/)).toBeTruthy();
  });
});

describe('URL query', () => {
  it('round-trips the view and ignores unknown values', () => {
    const query = parseQuery(
      new URLSearchParams('tab=waitlist&status=invited&country=in&page=3&q=acme'),
    );
    expect(query).toEqual({
      tab: 'waitlist',
      q: 'acme',
      role: '',
      status: 'invited',
      country: 'IN',
      verified: '',
      page: 3,
    });
    expect(serialiseQuery(query)).toBe('tab=waitlist&q=acme&status=invited&country=IN&page=3');
    expect(
      parseQuery(new URLSearchParams('role=root&page=-2&country=USA&status=pending')).role,
    ).toBe('');
    expect(parseQuery(new URLSearchParams('page=-2&country=USA')).page).toBe(1);
    expect(parseQuery(new URLSearchParams('status=pending')).status).toBe('');
  });
});
