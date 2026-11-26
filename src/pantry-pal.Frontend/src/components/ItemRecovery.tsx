import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ItemChanges, ItemMutationConflict } from '@pantry-pal/shared';
import type { BlockedView, ConflictView } from '../hooks/useItemRecovery';

interface Props {
  readonly conflicts: readonly ConflictView[];
  readonly blocked: readonly BlockedView[];
  readonly onKeepServer: (mutationId: string) => Promise<unknown>;
  readonly onUseMine: (mutationId: string) => Promise<unknown>;
  readonly onDiscard: (seq: number) => Promise<unknown>;
  readonly onRetry: (seq: number) => Promise<unknown>;
}

type Field = 'name' | 'crossedOff';

function blockedMessageKey(view: BlockedView): string {
  if (view.reason !== 'rejected')
    return `items.recovery.blocked.${view.reason}`;
  if (view.status === 400) return 'items.recovery.blocked.rejectedInvalid';
  if (view.status === 403) return 'items.recovery.blocked.rejectedForbidden';
  if (view.status === 404) return 'items.recovery.blocked.rejectedNotFound';
  return 'items.recovery.blocked.rejected';
}

function detailField(path: string): Field | null {
  const field = path.replace(/^changes\./, '');
  return field === 'name' || field === 'crossedOff' ? field : null;
}

/** Conflicts and blocked edits of one list, each with explicit, keyboard-operable ways to resolve it. */
export const ItemRecovery = memo(function ItemRecovery({
  conflicts,
  blocked,
  onKeepServer,
  onUseMine,
  onDiscard,
  onRetry,
}: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const count = conflicts.length + blocked.length;
  if (count === 0) return null;

  const fallbackName = t('items.recovery.unnamedItem');
  const label = (field: Field) => t(`items.recovery.field.${field}`);
  const show = (value: string | boolean) =>
    typeof value === 'boolean'
      ? t(value ? 'items.recovery.yes' : 'items.recovery.no')
      : value;

  return (
    <section className="recovery" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('items.recovery.heading')}</h2>
      <p role="status" className="muted">
        {t('items.recovery.summary', { count })}
      </p>
      <ul className="list-rows">
        {conflicts.map((view) => {
          const name = view.itemName ?? fallbackName;
          return (
            <li key={view.mutationId} className="list-row recovery__entry">
              <p className="recovery__message">
                {t('items.recovery.conflict.message', { name })}
              </p>
              <dl className="recovery__details">
                {view.conflicts.map((conflict: ItemMutationConflict) => (
                  <div key={conflict.field}>
                    <dt>{label(conflict.field)}</dt>
                    <dd>
                      {t('items.recovery.serverValue', {
                        value: show(conflict.serverValue),
                      })}
                    </dd>
                    <dd>
                      {t('items.recovery.yourValue', {
                        value: show(conflict.attemptedValue),
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  aria-label={t('items.recovery.conflict.keepLabel', { name })}
                  onClick={() => void onKeepServer(view.mutationId)}
                >
                  {t('items.recovery.conflict.keep')}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={t('items.recovery.conflict.useMineLabel', {
                    name,
                  })}
                  onClick={() => void onUseMine(view.mutationId)}
                >
                  {t('items.recovery.conflict.useMine')}
                </button>
              </div>
            </li>
          );
        })}
        {blocked.map((view) => {
          const name = view.itemName ?? fallbackName;
          const changes: ItemChanges = view.changes;
          const detailsId = `${headingId}-details-${view.seq}`;
          const describedBy = view.details.length > 0 ? detailsId : undefined;
          return (
            <li key={view.seq} className="list-row recovery__entry">
              <p className="recovery__message">
                {t(blockedMessageKey(view), {
                  name,
                  status: view.status,
                })}
              </p>
              {view.details.length > 0 && (
                <ul
                  id={detailsId}
                  className="recovery__problems"
                  aria-label={t('items.recovery.blocked.problems', { name })}
                >
                  {view.details.map((detail) => {
                    const field = detailField(detail.path);
                    return (
                      <li key={`${detail.path}:${detail.message}`}>
                        {field
                          ? t('items.recovery.blocked.problem', {
                              field: label(field),
                              message: detail.message,
                            })
                          : detail.message}
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl className="recovery__details">
                {changes.name !== undefined && (
                  <div>
                    <dt>{label('name')}</dt>
                    <dd>
                      {t('items.recovery.yourValue', { value: changes.name })}
                    </dd>
                  </div>
                )}
                {changes.crossedOff !== undefined && (
                  <div>
                    <dt>{label('crossedOff')}</dt>
                    <dd>
                      {t('items.recovery.yourValue', {
                        value: show(changes.crossedOff),
                      })}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  aria-label={t('items.recovery.blocked.discardLabel', {
                    name,
                  })}
                  aria-describedby={describedBy}
                  onClick={() => void onDiscard(view.seq)}
                >
                  {t('items.recovery.blocked.discard')}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={t('items.recovery.blocked.retryLabel', { name })}
                  aria-describedby={describedBy}
                  onClick={() => void onRetry(view.seq)}
                >
                  {t('items.recovery.blocked.retry')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

ItemRecovery.displayName = 'ItemRecovery';
