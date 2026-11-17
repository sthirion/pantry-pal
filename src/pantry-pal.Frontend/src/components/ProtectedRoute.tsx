import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import { useSession } from '../hooks/useSession';
import { ErrorScreen } from './ErrorScreen';
import { LoadingScreen } from './LoadingScreen';

/** Renders child routes only for a signed-in user; everyone else goes to the sign-in screen. */
export function ProtectedRoute() {
  const { t } = useTranslation();
  const session = useSession();
  switch (session.status) {
    case 'loading':
      return <LoadingScreen />;
    case 'signedOut':
      return <Navigate to="/sign-in" replace />;
    case 'error':
      return (
        <ErrorScreen message={t('session.error')} onRetry={session.retry} />
      );
    case 'signedIn':
      return <Outlet />;
  }
}
