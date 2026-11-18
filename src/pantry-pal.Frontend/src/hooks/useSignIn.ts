import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError } from '../services/apiClient';
import { authService } from '../services/authService';
import type { SignInCredentials } from '../services/authService';
import { QUERY_KEYS } from '../services/queryKeys';

export type SignInFailure =
  | 'invalidCredentials'
  | 'tooManyAttempts'
  | 'generic';

export function signInFailureFor(error: unknown): SignInFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'invalidCredentials';
    if (error.status === 429) return 'tooManyAttempts';
  }
  return 'generic';
}

export function useSignIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (credentials: SignInCredentials) => {
      await authService.signIn(credentials);
      // Load the session before navigating so the guarded lists screen renders without a redirect.
      await queryClient.fetchQuery({
        queryKey: QUERY_KEYS.me,
        queryFn: authService.getMe,
        staleTime: 0,
      });
    },
    onSuccess: () => navigate('/lists', { replace: true }),
  });
}
