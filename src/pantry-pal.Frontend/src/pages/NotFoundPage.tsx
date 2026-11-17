import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main className="screen">
      <h1>{t('notFound.title')}</h1>
      <Link to="/lists">{t('notFound.link')}</Link>
    </main>
  );
}
