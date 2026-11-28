import { useTranslation } from 'react-i18next';

interface AppLogoProps {
  readonly size?: 'small' | 'large';
}

/** The logo mark and app name; the image is decorative because the name is the accessible text. */
export function AppLogo({ size = 'small' }: AppLogoProps) {
  const { t } = useTranslation();
  return (
    <span className={`app-logo app-logo--${size}`}>
      <img
        className="app-logo__mark"
        src="/icons/icon.svg"
        alt=""
        width="512"
        height="512"
      />
      <span className="app-logo__name">{t('app.name')}</span>
    </span>
  );
}
