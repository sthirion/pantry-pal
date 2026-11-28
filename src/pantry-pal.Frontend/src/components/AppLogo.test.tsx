import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLogo } from './AppLogo';

describe('AppLogo', () => {
  it('shows the app name next to a decorative mark', () => {
    const { container } = render(<AppLogo />);

    expect(screen.getByText('Pantry Pal')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/icons/icon.svg',
    );
  });

  it('uses the large variant when asked', () => {
    const { container } = render(<AppLogo size="large" />);

    expect(container.firstElementChild).toHaveClass('app-logo--large');
  });
});
