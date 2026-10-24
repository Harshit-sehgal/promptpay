'use client';

import { type ReactNode, useId } from 'react';
import ModalDialog from '@/components/ui/modal-dialog';

import { formatDateTime } from './controls';
import { NotesSection } from './notes-section';
import { TagsEditor } from './tags-editor';
import type { WaitlistRow } from './types';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="people-group">
      <h3 className="people-group__title">{title}</h3>
      {children}
    </section>
  );
}

const humanize = (value: string) => {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** One waitlist signup with its tags and internal notes. */
export function WaitlistDetailDialog({
  row,
  onClose,
  onTagsChanged,
}: {
  row: WaitlistRow | null;
  onClose: () => void;
  onTagsChanged?: () => void;
}) {
  const titleId = useId();
  return (
    <ModalDialog
      open={row !== null}
      onClose={onClose}
      labelledBy={titleId}
      className="max-h-[90vh] max-w-2xl! overflow-y-auto p-4! sm:p-6!"
    >
      <div className="people-detail__head">
        <h2 id={titleId} className="dash-panel__title">
          {row?.email ?? 'Waitlist signup'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="dash-btn dash-btn--secondary dash-btn--sm"
        >
          Close
        </button>
      </div>
      {row && (
        <div className="people-detail">
          <Group title="Signup">
            <dl className="people-dl">
              <Field label="Email">{row.email}</Field>
              <Field label="Company">{row.company || '-'}</Field>
              <Field label="Country">{row.country || '-'}</Field>
              <Field label="Status">{humanize(row.status)}</Field>
              <Field label="Source">{humanize(row.source)}</Field>
              <Field label="Signed up">{formatDateTime(row.createdAt)}</Field>
            </dl>
          </Group>

          <Group title="Tags">
            <TagsEditor
              key={row.id}
              subject="waitlist"
              id={row.id}
              initialTags={row.tags ?? []}
              onChanged={onTagsChanged}
            />
          </Group>

          <Group title="Notes">
            <NotesSection key={row.id} subject="waitlist" id={row.id} />
          </Group>
        </div>
      )}
    </ModalDialog>
  );
}
