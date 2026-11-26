import type { z } from 'zod';
import type { ApiError } from './errors.js';
import type {
  deleteItemsBodySchema,
  itemChangesSchema,
  itemMutationBodySchema,
  putItemBodySchema,
  putListBodySchema,
} from './schemas.js';

export type PutListBody = z.infer<typeof putListBodySchema>;
export type PutItemBody = z.infer<typeof putItemBodySchema>;
export type DeleteItemsBody = z.infer<typeof deleteItemsBodySchema>;
export type ItemChanges = z.infer<typeof itemChangesSchema>;
export type ItemMutationBody = z.infer<typeof itemMutationBodySchema>;
export type ItemField = keyof ItemChanges;

export interface MeResponse {
  user: { id: string; name: string; email: string };
  household: { id: string; name: string };
}

export interface ShoppingList {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ListItem {
  id: string;
  listId: string;
  name: string;
  crossedOffAt: string | null;
  /** Household-wide sync cursor value of this item's last change; the `since` cursor domain. */
  version: number;
  /** Per-item merge revision; the base of an item mutation, never a `since` cursor. */
  itemRevision: number;
  updatedAt: string;
  deletedAt: string | null;
}

export type ItemMutationConflict =
  | { field: 'name'; attemptedValue: string; serverValue: string }
  | { field: 'crossedOff'; attemptedValue: boolean; serverValue: boolean };

/** `200` body of an accepted item mutation; `version` is the household sync cursor. */
export interface ItemMutationResponse {
  mutationId: string;
  item: ListItem;
  itemRevision: number;
  version: number;
  appliedFields: ItemField[];
  conflicts: ItemMutationConflict[];
  replayed: boolean;
}

/** `409` body of a rejected item mutation. */
export interface ItemMutationRejection extends ApiError {
  item: ListItem;
  itemRevision: number;
  version: number;
}

export interface Suggestion {
  name: string;
  useCount: number;
  lastUsedAt: string;
}

export interface SyncResponse {
  version: number;
  full: boolean;
  lists: ShoppingList[];
  items: ListItem[];
}

export interface SuggestionsResponse {
  suggestions: Suggestion[];
}

export type OutboxMutation =
  | { id: string; kind: 'putList'; listId: string; body: PutListBody }
  | { id: string; kind: 'deleteList'; listId: string; changedAt: string }
  | {
      id: string;
      kind: 'putItem';
      listId: string;
      itemId: string;
      body: PutItemBody;
    }
  | {
      id: string;
      kind: 'deleteItem';
      listId: string;
      itemId: string;
      changedAt: string;
    }
  | {
      id: string;
      kind: 'deleteItems';
      listId: string;
      body: DeleteItemsBody;
    };
