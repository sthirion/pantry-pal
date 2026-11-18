export const en = {
  app: { name: 'Pantry Pal' },
  common: {
    loading: 'Loading…',
    retry: 'Try again',
  },
  signIn: {
    title: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    invalidCredentials: 'Email or password is incorrect',
    tooManyAttempts: 'Too many attempts, try again in a minute',
    genericError: 'Something went wrong. Please try again.',
  },
  lists: {
    title: 'Lists',
    empty: 'No lists yet.',
    welcome: 'Signed in as {{name}} ({{household}}).',
  },
  signOut: {
    button: 'Sign out',
    pending: 'Signing out…',
    error: 'Could not sign out. Local data was not cleared. Please try again.',
  },
  session: {
    error: 'We could not check your sign-in status. Please try again.',
  },
  sync: {
    offline: 'You are offline. Changes are saved on this device.',
    pending_one: '{{count}} change waiting to sync',
    pending_other: '{{count}} changes waiting to sync',
    authRequired: 'Your session has expired. Sign in to keep syncing.',
    signInLink: 'Sign in',
    dropped:
      'The server rejected a change (error {{status}}). Your lists were refreshed from the server.',
    dismiss: 'Dismiss',
  },
  errorBoundary: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred.',
  },
  notFound: {
    title: 'Page not found',
    link: 'Go to lists',
  },
} as const;
