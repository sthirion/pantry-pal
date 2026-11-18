import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';

/** Placeholder lists screen; the list features arrive in later stories. */
export function ListsPage() {
  const { t } = useTranslation();
  const session = useSession();
  return (
    <main className="app-main">
      <h1>{t('lists.title')}</h1>
      {session.status === 'signedIn' && (
        <p className="muted">
          {t('lists.welcome', {
            name: session.me.user.name,
            household: session.me.household.name,
          })}
        </p>
      )}
      <p>{t('lists.empty')}</p>
    </main>
  );
}
