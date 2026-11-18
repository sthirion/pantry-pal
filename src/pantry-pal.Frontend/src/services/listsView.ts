import { displayName, nameKey } from '@pantry-pal/shared';
import type { ShoppingList } from '@pantry-pal/shared';

export const LIST_NAME_MAX = 100;

export type ListNameError = 'empty' | 'tooLong' | 'duplicate';

export interface ListSummary {
  list: ShoppingList;
  /** Items not crossed off and not deleted. */
  remaining: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Case-insensitive order for list names. */
export function compareListNames(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Returns why a list name is not allowed, or `null` when it is. `excludeId` is the list being renamed. */
export function validateListName(
  name: string,
  lists: readonly ShoppingList[],
  excludeId?: string,
): ListNameError | null {
  const cleaned = displayName(name);
  if (cleaned.length === 0) return 'empty';
  if (cleaned.length > LIST_NAME_MAX) return 'tooLong';
  const key = nameKey(cleaned);
  const clash = lists.some(
    (list) =>
      list.deletedAt === null &&
      list.id !== excludeId &&
      nameKey(list.name) === key,
  );
  return clash ? 'duplicate' : null;
}
