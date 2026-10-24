// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotesSection } from './notes-section';
import { addTagsToSet, isValidTag, MAX_TAGS } from './tags';
import { TagsEditor } from './tags-editor';

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getPersonNotes: vi.fn(),
    addPersonNote: vi.fn(),
    deletePersonNote: vi.fn(),
    setPersonTags: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('tag rules', () => {
  it('accepts the API pattern and nothing else', () => {
    for (const ok of ['a', 'vip', 'beta-tester', '9lives', 'a'.repeat(32)]) {
      expect(isValidTag(ok)).toBe(true);
    }
    for (const bad of ['', '-vip', 'VIP', 'has space', 'under_score', 'a'.repeat(33), 'x,y']) {
      expect(isValidTag(bad)).toBe(false);
    }
  });

  it('lowercases, trims, dedupes and sorts', () => {
    expect(addTagsToSet(['vip'], '  Press , VIP,beta ')).toEqual({
      ok: true,
      tags: ['beta', 'press', 'vip'],
    });
  });

  it('rejects an invalid tag, an empty entry and going over the limit', () => {
    const bad = addTagsToSet([], 'ok, no way');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.message).toContain('"no way"');
    expect(addTagsToSet([], ' , ').ok).toBe(false);
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(addTagsToSet(full, 'extra').ok).toBe(false);
    expect(addTagsToSet(full, 't1').ok).toBe(true);
  });
});

describe('TagsEditor', () => {
  it('adds a normalized tag on Enter and reports the saved set', async () => {
    vi.mocked(adminApi.setPersonTags).mockResolvedValue({
      data: { tags: ['press', 'vip'] },
    } as never);
    const onChanged = vi.fn();
    render(<TagsEditor subject="users" id="u-1" initialTags={['vip']} onChanged={onChanged} />);

    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: ' Press ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(adminApi.setPersonTags).toHaveBeenCalledWith('users', 'u-1', ['press', 'vip']),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(['press', 'vip']));
    expect(screen.getByRole('button', { name: 'Remove tag press' })).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('adds on a comma', async () => {
    vi.mocked(adminApi.setPersonTags).mockResolvedValue({ data: { tags: ['alpha'] } } as never);
    render(<TagsEditor subject="waitlist" id="w-1" initialTags={[]} />);
    fireEvent.change(screen.getByLabelText('Add a tag'), { target: { value: 'alpha,' } });
    await waitFor(() =>
      expect(adminApi.setPersonTags).toHaveBeenCalledWith('waitlist', 'w-1', ['alpha']),
    );
  });

  it('shows a validation message without calling the API', async () => {
    render(<TagsEditor subject="users" id="u-1" initialTags={[]} />);
    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'Not Valid!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    expect((await screen.findByRole('alert')).textContent).toContain('not valid');
    expect(adminApi.setPersonTags).not.toHaveBeenCalled();
  });

  it('removes a tag by saving the remaining set', async () => {
    vi.mocked(adminApi.setPersonTags).mockResolvedValue({ data: { tags: ['vip'] } } as never);
    render(<TagsEditor subject="users" id="u-1" initialTags={['press', 'vip']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag press' }));

    await waitFor(() =>
      expect(adminApi.setPersonTags).toHaveBeenCalledWith('users', 'u-1', ['vip']),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove tag press' })).toBeNull(),
    );
  });

  it('shows the API message verbatim and keeps the tags when saving fails', async () => {
    const message = 'Sign in again with two-factor to change this';
    vi.mocked(adminApi.setPersonTags).mockRejectedValue({
      response: { status: 403, data: { message } },
    });
    const onChanged = vi.fn();
    render(<TagsEditor subject="users" id="u-1" initialTags={['vip']} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag vip' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag vip' })).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('disables the remove buttons while saving', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(adminApi.setPersonTags).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );
    render(<TagsEditor subject="users" id="u-1" initialTags={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag a' }));
    expect(
      (screen.getByRole('button', { name: 'Remove tag b' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    resolve({ data: { tags: ['b'] } });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Remove tag b' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});

const note = (id: string, body: string) => ({
  id,
  body,
  createdAt: '2026-10-11T10:00:00.000Z',
  author: { id: 'a-1', email: 'admin@ateva.test' },
});

describe('NotesSection', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getPersonNotes).mockResolvedValue({
      data: [note('n-2', 'Newest note'), note('n-1', 'Older note')],
    } as never);
  });

  it('lists notes with the author', async () => {
    render(<NotesSection subject="users" id="u-1" />);
    expect(await screen.findByText('Newest note')).toBeTruthy();
    expect(screen.getByText('Older note')).toBeTruthy();
    expect(screen.getAllByText(/admin@ateva.test/)).toHaveLength(2);
    expect(adminApi.getPersonNotes).toHaveBeenCalledWith('users', 'u-1');
  });

  it('adds a trimmed note at the top and clears the field', async () => {
    vi.mocked(adminApi.addPersonNote).mockResolvedValue({
      data: note('n-3', 'Fresh note'),
    } as never);
    render(<NotesSection subject="waitlist" id="w-1" />);
    await screen.findByText('Newest note');
    const add = screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('New note'), { target: { value: '  Fresh note  ' } });
    fireEvent.click(add);

    await waitFor(() =>
      expect(adminApi.addPersonNote).toHaveBeenCalledWith('waitlist', 'w-1', 'Fresh note'),
    );
    const items = await screen.findAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Fresh note');
    expect((screen.getByLabelText('New note') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows an add failure and keeps the draft', async () => {
    vi.mocked(adminApi.addPersonNote).mockRejectedValue({
      response: { status: 403, data: { message: 'Recent two-factor sign-in required' } },
    });
    render(<NotesSection subject="users" id="u-1" />);
    await screen.findByText('Newest note');
    fireEvent.change(screen.getByLabelText('New note'), { target: { value: 'keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Recent two-factor sign-in required')).toBeTruthy();
    expect((screen.getByLabelText('New note') as HTMLTextAreaElement).value).toBe('keep me');
  });

  it('needs a second click to delete, and Cancel backs out', async () => {
    vi.mocked(adminApi.deletePersonNote).mockResolvedValue({ data: { deleted: true } } as never);
    render(<NotesSection subject="users" id="u-1" />);
    await screen.findByText('Newest note');

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete note/ })[0]!);
    expect(adminApi.deletePersonNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete note/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(adminApi.deletePersonNote).toHaveBeenCalledWith('n-2'));
    await waitFor(() => expect(screen.queryByText('Newest note')).toBeNull());
    expect(screen.getByText('Older note')).toBeTruthy();
  });

  it('shows an error with retry when notes fail to load', async () => {
    vi.mocked(adminApi.getPersonNotes).mockRejectedValueOnce(new Error('boom'));
    render(<NotesSection subject="users" id="u-1" />);
    expect(await screen.findByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Newest note')).toBeTruthy();
  });
});
