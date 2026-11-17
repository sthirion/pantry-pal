import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../services/apiClient';
import { authService } from '../services/authService';
import { QUERY_KEYS } from '../services/queryKeys';
import type { MeResponse } from '../services/auth.types';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signedOut' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'signedIn'; readonly me: MeResponse };

/** Resolves who is signed in. Only a `401` means signed out; any other failure is an error state. */
export function useSession(): SessionState {
  const query = useQuery({
    queryKey: QUERY_KEYS.me,
    queryFn: authService.getMe,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.data) return { status: 'signedIn', me: query.data };
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 401) {
      return { status: 'signedOut' };
    }
    return { status: 'error', retry: () => void query.refetch() };
  }
  return { status: 'loading' };
}
