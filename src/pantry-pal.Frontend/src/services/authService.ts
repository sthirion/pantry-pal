import { apiRequest } from './apiClient';
import type { MeResponse } from './auth.types';

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

export const authService = {
  getMe: () => apiRequest<MeResponse>('/api/me'),
  signIn: (credentials: SignInCredentials) =>
    apiRequest<unknown>('/api/auth/sign-in/email', {
      method: 'POST',
      body: credentials,
    }),
  signOut: () =>
    apiRequest<unknown>('/api/auth/sign-out', { method: 'POST', body: {} }),
};
