import { clearCrossedOff, removeItem, saveItem } from '../services/mutations';
import { syncEngine } from '../services/sync-engine';

/** Local-first item writes for one list; each asks the sync engine to send the change (it stays queued when offline). */
export function useItemActions(listId: string) {
  const flush = () => void syncEngine.flush().catch(() => undefined);
  return {
    add: async (name: string) => {
      const id = await saveItem(listId, { name, crossedOff: false });
      flush();
      return id;
    },
    /** Renames, crosses off, or restores an existing item. */
    update: async (id: string, name: string, crossedOff: boolean) => {
      await saveItem(listId, { name, crossedOff }, id);
      flush();
    },
    remove: async (id: string) => {
      await removeItem(listId, id);
      flush();
    },
    clearCrossedOff: async () => {
      await clearCrossedOff(listId);
      flush();
    },
  };
}
