import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSyncNotices, dismissDropped } from '../services/syncNotices';
import { useSyncStatus } from '../hooks/useSyncStatus';

/** Shows offline state, queued changes, a dropped-change error, and the sign-in prompt after a `401`. */
export function SyncStatus() {
  const { t } = useTranslation();
  const { online, pendingCount, reviewCount } = useSyncStatus();
  const { droppedStatus, authRequired } = useSyncNotices();

  return (
    <div className="sync-status">
      <p role="status" className="muted sync-status__summary">
        {!online && <span>{t('sync.offline')} </span>}
        {pendingCount > 0 && (
          <span>{t('sync.pending', { count: pendingCount })}</span>
        )}
        {reviewCount > 0 && (
          <span> {t('sync.needsReview', { count: reviewCount })}</span>
        )}
      </p>
      {authRequired && (
        <p role="alert" className="error-text">
          {t('sync.authRequired')}{' '}
          <Link to="/sign-in">{t('sync.signInLink')}</Link>
        </p>
      )}
      {droppedStatus !== null && (
        <p role="alert" className="error-text">
          {t('sync.dropped', { status: droppedStatus })}{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={dismissDropped}
          >
            {t('sync.dismiss')}
          </button>
        </p>
      )}
    </div>
  );
}
