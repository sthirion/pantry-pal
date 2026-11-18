import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/apiClient';
import { signInFailureFor } from './useSignIn';

describe('signInFailureFor', () => {
  it.each([
    [401, 'invalidCredentials'],
    [429, 'tooManyAttempts'],
    [400, 'generic'],
    [500, 'generic'],
    [503, 'generic'],
  ])('maps an API %i to %s', (status, expected) => {
    expect(signInFailureFor(new ApiError(status))).toBe(expected);
  });

  it.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['a non-error value', 'boom'],
    ['undefined', undefined],
  ])('treats %s as generic', (_label, error) => {
    expect(signInFailureFor(error)).toBe('generic');
  });
});
