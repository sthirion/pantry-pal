import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  count: number;
  onConfirm: () => Promise<unknown>;
}

/** "Clear crossed off" with a confirmation step. */
export function ClearCrossedOff({ count, onConfirm }: Props) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="button button--secondary"
        onClick={() => setConfirming(true)}
      >
        {t('items.clear.button')}
      </button>
    );
  }

  return (
    <div role="group" aria-label={t('items.clear.group')}>
      <p>{t('items.clear.confirm', { count })}</p>
      <div className="list-row__actions">
        <button
          type="button"
          className="button"
          onClick={async () => {
            await onConfirm();
            setConfirming(false);
          }}
        >
          {t('items.clear.confirmButton')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setConfirming(false)}
        >
          {t('items.cancel')}
        </button>
      </div>
    </div>
  );
}
