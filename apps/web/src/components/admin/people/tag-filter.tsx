'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminApi, type PeopleSubject } from '@/lib/api/services';

import { SelectFilter } from './controls';
import type { TagCount } from './types';

/**
 * The Tag filter: "Any tag" plus every tag in use with its count. `version`
 * changes after a tag edit, which reloads the list of tags.
 */
export function TagFilter({
  subject,
  value,
  version,
  onChange,
}: {
  subject: PeopleSubject;
  value: string;
  version: number;
  onChange: (tag: string) => void;
}) {
  const [tags, setTags] = useState<TagCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getPeopleTags(subject)
      .then((res: { data: TagCount[] }) => {
        if (!cancelled) setTags(Array.isArray(res.data) ? res.data : []);
      })
      // The filter still works from the URL value; only the choices are missing.
      .catch(() => {
        if (!cancelled) setTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [subject, version]);

  const options = useMemo(() => {
    const list = tags.map((t) => ({
      value: t.tag,
      label: `${t.tag} (${t.count.toLocaleString()})`,
    }));
    // Keep a tag from the URL selectable even when it is no longer in use.
    if (value && !list.some((o) => o.value === value)) list.push({ value, label: value });
    return [{ value: '', label: 'Any tag' }, ...list];
  }, [tags, value]);

  return <SelectFilter label="Tag" value={value} onChange={onChange} options={options} />;
}
