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
  errorBoundary: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred.',
  },
  notFound: {
    title: 'Page not found',
    link: 'Go to lists',
  },
} as const;
