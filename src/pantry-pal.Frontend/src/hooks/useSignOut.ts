import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { authService } from '../services/authService';
import { clearLocalData } from '../services/localData';

/** Signs out on the server, then wipes local data; only a fully successful run leaves the app. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      await authService.signOut();
      await clearLocalData();
    },
    onSuccess: () => {
      queryClient.clear();
      navigate('/sign-in', { replace: true });
    },
  });
}
