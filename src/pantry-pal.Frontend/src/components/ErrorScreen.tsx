import { useTranslation } from 'react-i18next';

interface ErrorScreenProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  const { t } = useTranslation();
  return (
    <main className="screen">
      <p role="alert" className="error-text">
        {message}
      </p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </main>
  );
}
