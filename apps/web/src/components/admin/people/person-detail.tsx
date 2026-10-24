'use client';

import { type ReactNode, useEffect, useId, useState } from 'react';
import { Notice, Pill } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';

import { formatDateTime, userStatusTone } from './controls';
import { NotesSection } from './notes-section';
import { TagsEditor } from './tags-editor';
import type { PersonDetail } from './types';

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

const yesNo = (value: boolean, yes: string, no: string) => (value ? yes : no);
const orDash = (value: string | null | undefined) => (value ? value : '-');

function DetailBody({
  person,
  onOpenUser,
  onTagsChanged,
}: {
  person: PersonDetail;
  onOpenUser: (id: string) => void;
  onTagsChanged?: () => void;
}) {
  return (
    <div className="people-detail">
      <Group title="Identity">
        <dl className="people-dl">
          <Field label="Name">{orDash(person.name)}</Field>
          <Field label="Email">{person.email}</Field>
          <Field label="User ID">
            <span className="dash-mono">{person.id}</span>
          </Field>
          <Field label="Role">{humanize(person.role)}</Field>
          <Field label="Country">{orDash(person.country)}</Field>
          <Field label="Referral code">
            <span className="dash-mono">{orDash(person.referralCode)}</span>
          </Field>
          <Field label="Joined">{formatDateTime(person.createdAt)}</Field>
          <Field label="Updated">{formatDateTime(person.updatedAt)}</Field>
        </dl>
      </Group>

      <Group title="Verification">
        <dl className="people-dl">
          <Field label="Email">{yesNo(person.emailVerified, 'Verified', 'Not verified')}</Field>
          <Field label="Google">{yesNo(person.googleVerified, 'Linked', 'Not linked')}</Field>
          <Field label="GitHub">{yesNo(person.githubVerified, 'Linked', 'Not linked')}</Field>
          <Field label="Two-factor">{yesNo(person.twoFactorEnabled, 'On', 'Off')}</Field>
        </dl>
      </Group>

      <Group title="Account">
        <dl className="people-dl">
          <Field label="Status">
            <Pill tone={userStatusTone(person.status)}>{person.status}</Pill>
          </Field>
          <Field label="Trust level">{humanize(person.trustLevel)}</Field>
          <Field label="Open fraud flags">{person.openFlags.toLocaleString()}</Field>
          <Field label="Last seen">{formatDateTime(person.lastSeenAt)}</Field>
        </dl>
      </Group>

      <Group title="Advertiser">
        {person.advertiser ? (
          <dl className="people-dl">
            <Field label="Company">{orDash(person.advertiser.companyName)}</Field>
            <Field label="Billing email">{orDash(person.advertiser.billingEmail)}</Field>
            <Field label="Website">{orDash(person.advertiser.websiteUrl)}</Field>
            <Field label="Trust status">
              {person.advertiser.trustStatus
                ? humanize(person.advertiser.trustStatus)
                : orDash(null)}
            </Field>
          </dl>
        ) : (
          <p className="people-empty">No advertiser profile.</p>
        )}
      </Group>

      <Group title="Consents">
        {person.consents.length === 0 ? (
          <p className="people-empty">No consent records.</p>
        ) : (
          <ul className="people-list">
            {person.consents.map((consent, index) => (
              <li key={`${consent.purpose}-${consent.createdAt}-${index}`}>
                <span className="people-list__main">
                  {humanize(consent.purpose)}
                  <span className="people-list__sub"> v{consent.version}</span>
                </span>
                <span>{consent.granted ? 'Granted' : 'Not granted'}</span>
                <span className="people-list__sub">{formatDateTime(consent.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {person.consents.length >= 50 && (
          <p className="people-empty">Showing the newest 50 records.</p>
        )}
      </Group>

      <Group title={`Devices (${person.deviceCount.toLocaleString()})`}>
        {person.devices.length === 0 ? (
          <p className="people-empty">No devices registered.</p>
        ) : (
          <ul className="people-list">
            {person.devices.map((device) => (
              <li key={device.id}>
                <span className="people-list__main">
                  {device.toolType}
                  <span className="people-list__sub">
                    {' '}
                    {[device.platform, device.extensionVersion && `v${device.extensionVersion}`]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </span>
                <span className="people-list__sub">
                  First seen {formatDateTime(device.createdAt)}
                </span>
                <span className="people-list__sub">
                  Last seen {formatDateTime(device.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {person.devices.length >= 50 && (
          <p className="people-empty">Showing the 50 most recently seen devices.</p>
        )}
      </Group>

      <Group title="Referrals">
        <dl className="people-dl">
          <Field label="Referred by">
            {person.referredBy ? (
              <button
                type="button"
                className="people-link"
                onClick={() => onOpenUser(person.referredBy!.id)}
              >
                {person.referredBy.email}
              </button>
            ) : (
              'Nobody'
            )}
          </Field>
          <Field label="People referred">{person.referralsMade.toLocaleString()}</Field>
        </dl>
      </Group>

      <Group title="Tags">
        <TagsEditor
          subject="users"
          id={person.id}
          initialTags={person.tags ?? []}
          onChanged={onTagsChanged}
        />
      </Group>

      <Group title="Notes">
        <NotesSection subject="users" id={person.id} />
      </Group>
    </div>
  );
}

/** Everything the API holds about one registered user, grouped for scanning. */
export function PersonDetailDialog({
  userId,
  onClose,
  onOpenUser,
  onTagsChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onOpenUser: (id: string) => void;
  /** Called after the tags save, so the table rows and tag filter can refresh. */
  onTagsChanged?: () => void;
}) {
  const titleId = useId();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setPerson(null);
    setError(null);
    adminApi
      .getPeopleUser(userId)
      .then((res: { data: PersonDetail }) => {
        if (!cancelled) setPerson(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load this person'));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  return (
    <ModalDialog
      open={userId !== null}
      onClose={onClose}
      labelledBy={titleId}
      className="max-h-[90vh] max-w-2xl! overflow-y-auto p-4! sm:p-6!"
    >
      <div className="people-detail__head">
        <h2 id={titleId} className="dash-panel__title">
          {person ? person.name || person.email : 'Person'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="dash-btn dash-btn--secondary dash-btn--sm"
        >
          Close
        </button>
      </div>
      {error ? (
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
          {error}
        </Notice>
      ) : person ? (
        <DetailBody person={person} onOpenUser={onOpenUser} onTagsChanged={onTagsChanged} />
      ) : (
        <p className="people-empty" role="status">
          Loading details.
        </p>
      )}
    </ModalDialog>
  );
}

function humanize(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
