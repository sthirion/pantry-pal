import type { z } from 'zod';
import type {
  changePasswordBodySchema,
  deleteItemsBodySchema,
  putItemBodySchema,
  putListBodySchema,
  updateProfileBodySchema,
} from './schemas.js';

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type PutListBody = z.infer<typeof putListBodySchema>;
export type PutItemBody = z.infer<typeof putItemBodySchema>;
export type DeleteItemsBody = z.infer<typeof deleteItemsBodySchema>;

export interface MeResponse {
  user: { id: string; name: string; email: string };
  household: { id: string; name: string };
}

export interface UpdateProfileResponse {
  user: MeResponse['user'];
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
  version: number;
  updatedAt: string;
  deletedAt: string | null;
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
