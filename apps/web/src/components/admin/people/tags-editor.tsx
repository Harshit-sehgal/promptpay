'use client';

import { useId, useState } from 'react';
import { Notice } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi, type PeopleSubject } from '@/lib/api/services';

import { addTagsToSet, MAX_TAGS } from './tags';

/** Read-only tag chips, used under a person in the tables. */
export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="people-tags" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag} className="people-tag">
          {tag}
        </li>
      ))}
    </ul>
  );
}

/**
 * Chips with remove buttons and an input that adds on Enter or comma. Every
 * change saves the whole set at once; nothing shows as changed until the API
 * accepts it.
 */
export function TagsEditor({
  subject,
  id,
  initialTags,
  onChanged,
}: {
  subject: PeopleSubject;
  id: string;
  initialTags: string[];
  /** Called with the saved tags so the list rows and tag filter can refresh. */
  onChanged?: (tags: string[]) => void;
}) {
  const inputId = useId();
  const messageId = useId();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (next: string[]): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = (await adminApi.setPersonTags(subject, id, next)) as {
        data?: { tags?: string[] };
      };
      const saved = Array.isArray(res?.data?.tags) ? res.data.tags : next;
      setTags(saved);
      onChanged?.(saved);
      return true;
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'The tags were not saved'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async (raw: string) => {
    const result = addTagsToSet(tags, raw);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    if (await save(result.tags)) setText('');
  };

  const remove = (tag: string) => {
    setProblem(null);
    void save(tags.filter((t) => t !== tag));
  };

  const atLimit = tags.length >= MAX_TAGS;

  return (
    <div className="people-tags-editor">
      {tags.length === 0 ? (
        <p className="people-empty">No tags.</p>
      ) : (
        <ul className="people-tags" aria-label="Tags">
          {tags.map((tag) => (
            <li key={tag} className="people-tag">
              {tag}
              <button
                type="button"
                className="people-tag__remove"
                aria-label={`Remove tag ${tag}`}
                disabled={saving}
                onClick={() => remove(tag)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="people-tags-editor__row">
        <label htmlFor={inputId} className="sr-only">
          Add a tag
        </label>
        <input
          id={inputId}
          type="text"
          value={text}
          maxLength={80}
          // Read-only while saving keeps focus, so several tags can be typed in a row.
          readOnly={saving}
          disabled={atLimit}
          placeholder={atLimit ? 'Tag limit reached' : 'Add a tag, press Enter'}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? messageId : undefined}
          onChange={(event) => {
            const value = event.target.value;
            if (value.includes(',')) void add(value);
            else {
              setText(value);
              setProblem(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter must not submit or close anything around the editor.
            event.preventDefault();
            if (text.trim()) void add(text);
          }}
          className="min-w-0 flex-1 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void add(text)}
          disabled={saving || atLimit || text.trim() === ''}
          className="dash-btn dash-btn--secondary dash-btn--sm"
        >
          {saving ? 'Saving' : 'Add tag'}
        </button>
      </div>
      {problem && (
        <p id={messageId} className="people-field-error" role="alert">
          {problem}
        </p>
      )}
      {saveError && (
        <Notice tone="bad" role="alert">
          {saveError}
        </Notice>
      )}
    </div>
  );
}
