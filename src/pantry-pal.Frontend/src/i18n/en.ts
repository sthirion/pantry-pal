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
  items: {
    back: 'Back to lists',
    loadError: 'Could not load this list. Please reload the page.',
    notFound: 'This list no longer exists.',
    empty: 'No items yet. Add your first item above.',
    activeSection: 'Items to buy',
    crossedOffSection: 'Crossed Off',
    alreadyOnList: 'Already on the list',
    cancel: 'Cancel',
    crossedOffState: 'Crossed off',
    crossOff: 'Cross off {{name}}',
    restore: 'Restore {{name}}',
    add: { label: 'Add an item', submit: 'Add item' },
    suggestions: {
      label: 'Suggestions',
      count_one: '{{count}} suggestion available',
      count_other: '{{count}} suggestions available',
    },
    errors: {
      empty: 'Enter an item name.',
      tooLong: 'An item name can have at most {{max}} characters.',
      duplicate: 'This list already has an item with this name.',
    },
    menu: { button: 'Actions for {{name}}' },
    rename: {
      short: 'Rename',
      label: 'New name for {{name}}',
      save: 'Save',
    },
    delete: { short: 'Delete' },
    recovery: {
      heading: 'Changes to review',
      summary_one: '{{count}} change needs your review.',
      summary_other: '{{count}} changes need your review.',
      unnamedItem: 'this item',
      field: { name: 'Name', crossedOff: 'Crossed off' },
      yes: 'Yes',
      no: 'No',
      serverValue: 'Current value: {{value}}',
      yourValue: 'Your value: {{value}}',
      conflict: {
        message:
          'Someone else changed "{{name}}" while you were offline. The current value was kept.',
        keep: 'Keep current',
        keepLabel: 'Keep current value of {{name}}',
        useMine: 'Use my value',
        useMineLabel: 'Use my value for {{name}}',
      },
      blocked: {
        BASE_VERSION_EXPIRED:
          'Your change to "{{name}}" is too old to merge automatically. Nothing was applied.',
        BASE_VERSION_AHEAD:
          'Your change to "{{name}}" was based on a version the server does not have. Nothing was applied.',
        MUTATION_ID_REUSED:
          'Your change to "{{name}}" could not be sent because its identifier was already used. Nothing was applied.',
        rejected:
          'Your change to "{{name}}" was not accepted (error {{status}}). Nothing was applied.',
        rejectedInvalid:
          'Your change to "{{name}}" was not valid. Nothing was applied. Discard it and enter the value again.',
        rejectedForbidden:
          'You do not have access to the list for your change to "{{name}}". Nothing was applied.',
        rejectedNotFound:
          'Your change to "{{name}}" could not be applied because the item was not found in this list. Nothing was applied.',
        problems: 'Problems with your change to {{name}}',
        problem: '{{field}}: {{message}}',
        discard: 'Discard my change',
        discardLabel: 'Discard my change to {{name}}',
        retry: 'Apply my change again',
        retryLabel: 'Apply my change again for {{name}}',
      },
    },
    clear: {
      button: 'Clear crossed off',
      group: 'Confirm clearing crossed-off items',
      confirm_one: 'Remove {{count}} crossed-off item?',
      confirm_other: 'Remove {{count}} crossed-off items?',
      confirmButton: 'Clear crossed off',
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
    needsReview_one:
      '{{count}} change needs your review. Open its list to resolve it.',
    needsReview_other:
      '{{count}} changes need your review. Open their lists to resolve them.',
    authRequired: 'Your session has expired. Sign in to keep syncing.',
    signInLink: 'Sign in',
    dropped:
      "One of your changes couldn't be saved because the server didn't accept it (error {{status}}). Your lists were refreshed from the server.",
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
