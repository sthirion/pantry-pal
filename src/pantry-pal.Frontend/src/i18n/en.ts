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
    empty: 'No lists yet. Create your first list above.',
    welcome: 'Signed in as {{name}} ({{household}}).',
    loadError: 'Could not load your lists. Please reload the page.',
    remaining_one: '{{count}} item left',
    remaining_other: '{{count}} items left',
    cancel: 'Cancel',
    create: { label: 'New list name', submit: 'Create list' },
    errors: {
      empty: 'Enter a list name.',
      tooLong: 'A list name can have at most {{max}} characters.',
      duplicate: 'You already have a list with this name.',
    },
    rename: {
      button: 'Rename {{name}}',
      short: 'Rename',
      label: 'New name for {{name}}',
      save: 'Save',
    },
    delete: {
      button: 'Delete {{name}}',
      short: 'Delete',
      group: 'Confirm deleting {{name}}',
      confirm: 'Delete "{{name}}" and all its items?',
      confirmButton: 'Delete list',
    },
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
