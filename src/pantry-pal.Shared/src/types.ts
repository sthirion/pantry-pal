import type { z } from 'zod';
import type {
  deleteItemsBodySchema,
  putItemBodySchema,
  putListBodySchema,
} from './schemas.js';

export type PutListBody = z.infer<typeof putListBodySchema>;
export type PutItemBody = z.infer<typeof putItemBodySchema>;
export type DeleteItemsBody = z.infer<typeof deleteItemsBodySchema>;

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
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Suggestion {
  name: string;
  useCount: number;
  lastUsedAt: string;
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
