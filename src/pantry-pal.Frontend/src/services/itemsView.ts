import { displayName, nameKey } from '@pantry-pal/shared';
import type { ListItem } from '@pantry-pal/shared';

export const ITEM_NAME_MAX = 200;

export type ItemNameError = 'empty' | 'tooLong' | 'duplicate';

export interface ItemSections {
  /** Not crossed off, in the order they were added. */
  active: ListItem[];
  /** Crossed off, most recently crossed off first. */
  crossedOff: ListItem[];
}

/** Returns why an item name is not allowed (empty or too long), or `null`. */
export function validateItemName(name: string): 'empty' | 'tooLong' | null {
  const cleaned = displayName(name);
  if (cleaned.length === 0) return 'empty';
  if (cleaned.length > ITEM_NAME_MAX) return 'tooLong';
  return null;
}

/** Finds a not-deleted item with the same name ignoring case and spacing. `excludeId` is the item being renamed. */
export function findItemByName(
  name: string,
  items: readonly ListItem[],
  excludeId?: string,
): ListItem | undefined {
  const key = nameKey(displayName(name));
  return items.find(
    (item) =>
      item.deletedAt === null &&
      item.id !== excludeId &&
      nameKey(item.name) === key,
  );
}

/** Validation for renaming: the add rules plus no clash with another item. */
export function validateItemRename(
  name: string,
  items: readonly ListItem[],
  itemId: string,
): ItemNameError | null {
  return (
    validateItemName(name) ??
    (findItemByName(name, items, itemId) ? 'duplicate' : null)
  );
}

/** Splits a list's items into the active and crossed-off sections, ignoring deleted items. */
export function splitItems(items: readonly ListItem[]): ItemSections {
  const live = items.filter((item) => item.deletedAt === null);
  const active = live
    .filter((item) => item.crossedOffAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const crossedOff = live
    .filter((item) => item.crossedOffAt !== null)
    .sort((a, b) =>
      (a.crossedOffAt as string) < (b.crossedOffAt as string)
        ? 1
        : (a.crossedOffAt as string) > (b.crossedOffAt as string)
          ? -1
          : 0,
    );
  return { active, crossedOff };
}
