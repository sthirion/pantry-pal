import { useTranslation } from 'react-i18next';

export function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <main className="screen" aria-busy="true">
      <p role="status">{t('common.loading')}</p>
    </main>
  );
}
