'use client';

import { useEffect, useId, useState } from 'react';
import { Notice } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi, type PeopleSubject } from '@/lib/api/services';

import { formatDateTime } from './controls';
import type { PersonNote } from './types';

export const NOTE_MAX = 2000;

/** Internal notes about one person, newest first, with add and delete. */
export function NotesSection({ subject, id }: { subject: PeopleSubject; id: string }) {
  const fieldId = useId();
  const [notes, setNotes] = useState<PersonNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    adminApi
      .getPersonNotes(subject, id)
      .then((res: { data: PersonNote[] }) => {
        if (!cancelled) setNotes(Array.isArray(res.data) ? res.data : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load notes'));
      });
    return () => {
      cancelled = true;
    };
  }, [subject, id, attempt]);

  const body = draft.trim();

  const add = async () => {
    if (!body) return;
    setAdding(true);
    setWriteError(null);
    try {
      const res = (await adminApi.addPersonNote(subject, id, body)) as { data: PersonNote };
      setNotes((current) => [res.data, ...(current ?? [])]);
      setDraft('');
    } catch (err: unknown) {
      setWriteError(getErrorMessage(err, 'The note was not saved'));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (noteId: string) => {
    setDeleting(noteId);
    setWriteError(null);
    try {
      await adminApi.deletePersonNote(noteId);
      setNotes((current) => (current ?? []).filter((n) => n.id !== noteId));
      setConfirming(null);
    } catch (err: unknown) {
      setWriteError(getErrorMessage(err, 'The note was not deleted'));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="people-notes">
      {loadError ? (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="dash-btn dash-btn--secondary dash-btn--sm"
            >
              Retry
            </button>
          }
        >
          {loadError}
        </Notice>
      ) : notes === null ? (
        <p className="people-empty" role="status">
          Loading notes.
        </p>
      ) : notes.length === 0 ? (
        <p className="people-empty">No notes yet.</p>
      ) : (
        <ul className="people-notes__list">
          {notes.map((note) => {
            const who = note.author?.email ?? 'a removed admin';
            return (
              <li key={note.id} className="people-note">
                <p className="people-note__body">{note.body}</p>
                <div className="people-note__meta">
                  <span>
                    {who}, <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
                  </span>
                  {confirming === note.id ? (
                    <span className="people-note__actions">
                      <button
                        type="button"
                        disabled={deleting === note.id}
                        onClick={() => remove(note.id)}
                        className="dash-btn dash-btn--danger dash-btn--sm"
                      >
                        {deleting === note.id ? 'Deleting' : 'Confirm delete'}
                      </button>
                      <button
                        type="button"
                        disabled={deleting === note.id}
                        onClick={() => setConfirming(null)}
                        className="dash-btn dash-btn--ghost dash-btn--sm"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setWriteError(null);
                        setConfirming(note.id);
                      }}
                      aria-label={`Delete note by ${who}`}
                      className="dash-btn dash-btn--ghost dash-btn--sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="people-notes__form">
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
          New note
        </label>
        <textarea
          id={fieldId}
          value={draft}
          rows={3}
          maxLength={NOTE_MAX}
          disabled={adding}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full px-3 py-2 text-sm"
        />
        <div className="people-notes__submit">
          <span className="text-xs text-[var(--muted)]">
            {draft.length.toLocaleString()} of {NOTE_MAX.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={add}
            disabled={adding || body === ''}
            className="dash-btn dash-btn--primary dash-btn--sm"
          >
            {adding ? 'Saving' : 'Add note'}
          </button>
        </div>
      </div>
      {writeError && (
        <Notice tone="bad" role="alert">
          {writeError}
        </Notice>
      )}
    </div>
  );
}
