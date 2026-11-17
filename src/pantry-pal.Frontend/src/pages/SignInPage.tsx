import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { signInFailureFor, useSignIn } from '../hooks/useSignIn';

export function SignInPage() {
  const { t } = useTranslation();
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  const failure = signIn.isError ? signInFailureFor(signIn.error) : undefined;
  const errorMessage =
    failure === 'invalidCredentials'
      ? t('signIn.invalidCredentials')
      : failure === 'tooManyAttempts'
        ? t('signIn.tooManyAttempts')
        : failure === 'generic'
          ? t('signIn.genericError')
          : undefined;

  return (
    <main className="screen">
      <form
        className="card"
        onSubmit={onSubmit}
        aria-labelledby="sign-in-title"
      >
        <h1 id="sign-in-title">{t('signIn.title')}</h1>
        {errorMessage && (
          <p role="alert" className="error-text">
            {errorMessage}
          </p>
        )}
        <div className="field">
          <label htmlFor="email">{t('signIn.email')}</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">{t('signIn.password')}</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="button button--block"
          disabled={signIn.isPending}
        >
          {signIn.isPending ? t('signIn.submitting') : t('signIn.submit')}
        </button>
      </form>
    </main>
  );
}
