import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useSignOut } from '../hooks/useSignOut';
import { useSyncEngine } from '../hooks/useSyncEngine';
import { SyncStatus } from './SyncStatus';

export function AppShell() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  useSyncEngine();
  return (
    <>
      <header className="app-header">
        <span className="app-title">{t('app.name')}</span>
        <button
          type="button"
          className="button button--secondary"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {signOut.isPending ? t('signOut.pending') : t('signOut.button')}
        </button>
      </header>
      <SyncStatus />
      {signOut.isError && (
        <p role="alert" className="error-text app-main">
          {t('signOut.error')}
        </p>
      )}
      <Outlet />
    </>
  );
}
