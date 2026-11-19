import { removeList, saveList } from '../services/mutations';
import { syncEngine } from '../services/sync-engine';

/** Local-first list writes; each asks the sync engine to send the change (it stays queued when offline). */
export function useListActions() {
  const flush = () => void syncEngine.flush().catch(() => undefined);
  return {
    create: async (name: string) => {
      const id = await saveList(name);
      flush();
      return id;
    },
    rename: async (id: string, name: string) => {
      await saveList(name, id);
      flush();
    },
    remove: async (id: string) => {
      await removeList(id);
      flush();
    },
  };
}
