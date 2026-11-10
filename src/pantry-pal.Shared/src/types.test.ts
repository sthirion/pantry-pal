import { describe, expect, it } from 'vitest';
import type {
  ApiError,
  ApiErrorCode,
  ApiErrorDetail,
  DeleteItemsBody,
  ListItem,
  OutboxMutation,
  PutItemBody,
  PutListBody,
  ShoppingList,
  Suggestion,
} from './index.js';

describe('shared types', () => {
  it('accepts every documented error code and rejects unknown ones', () => {
    const codes: ApiErrorCode[] = [
      'validation_failed',
      'unauthenticated',
      'forbidden',
      'not_found',
      'name_taken',
      'rate_limited',
      'internal_error',
    ];
    // @ts-expect-error unknown codes are not assignable
    const bad: ApiErrorCode = 'bad_request';
    const body: ApiError = { error: { code: codes[0]!, message: 'm' } };
    expect(codes).toHaveLength(7);
    expect(bad).toBe('bad_request');
    expect(body.error.details).toBeUndefined();
  });

  it('types ApiError details as path/message entries', () => {
    const withDetails: ApiError = {
      error: {
        code: 'validation_failed',
        message: 'm',
        details: [{ path: 'name', message: 'required' }],
      },
    };
    const detail: ApiErrorDetail = { path: 'p', message: 'm' };
    const badPath: ApiErrorDetail = {
      // @ts-expect-error path must be a string
      path: 1,
      message: 'm',
    };
    // @ts-expect-error message is required
    const noMessage: ApiErrorDetail = { path: 'p' };
    const badDetails: ApiError = {
      error: {
        code: 'validation_failed',
        message: 'm',
        // @ts-expect-error details must be an array of ApiErrorDetail
        details: 'nope',
      },
    };
    expect(withDetails.error.details?.[0]?.path).toBe('name');
    expect(detail.message).toBe('m');
    expect([badPath, noMessage, badDetails]).toHaveLength(3);
  });

  it('types ListItem and Suggestion fields', () => {
    const item: ListItem = {
      id: 'i',
      listId: 'l',
      name: 'n',
      crossedOffAt: null,
      version: 1,
      updatedAt: 'u',
      deletedAt: null,
    };
    // @ts-expect-error crossedOffAt must be string | null
    const bad: ListItem = { ...item, crossedOffAt: undefined };
    const badSuggestion: Suggestion = {
      name: 'n',
      // @ts-expect-error useCount must be a number
      useCount: '1',
      lastUsedAt: 'u',
    };
    const s: Suggestion = { name: 'n', useCount: 1, lastUsedAt: 'u' };
    expect(item.listId).toBe('l');
    expect(bad.name).toBe('n');
    expect(badSuggestion.name).toBe('n');
    expect(s.useCount).toBe(1);
  });

  it('types body types from the schemas', () => {
    const put: PutListBody = { name: 'n', changedAt: 'c' };
    const item: PutItemBody = { name: 'n', crossedOff: true, changedAt: 'c' };
    const del: DeleteItemsBody = { itemIds: ['a'], changedAt: 'c' };
    // @ts-expect-error crossedOff must be boolean
    const badItem: PutItemBody = { name: 'n', crossedOff: 'x', changedAt: 'c' };
    // @ts-expect-error itemIds must be an array
    const badDel: DeleteItemsBody = { itemIds: 'a', changedAt: 'c' };
    expect([put, item, del, badItem, badDel]).toHaveLength(5);
  });

  it('discriminates every OutboxMutation variant', () => {
    const put: PutListBody = { name: 'n', changedAt: 'c' };
    const item: PutItemBody = { name: 'n', crossedOff: false, changedAt: 'c' };
    const del: DeleteItemsBody = { itemIds: ['a'], changedAt: 'c' };
    const all: OutboxMutation[] = [
      { id: '1', kind: 'putList', listId: 'l', body: put },
      { id: '2', kind: 'deleteList', listId: 'l', changedAt: 'c' },
      { id: '3', kind: 'putItem', listId: 'l', itemId: 'i', body: item },
      { id: '4', kind: 'deleteItem', listId: 'l', itemId: 'i', changedAt: 'c' },
      { id: '5', kind: 'deleteItems', listId: 'l', body: del },
    ];
    // @ts-expect-error unknown kind
    const badKind: OutboxMutation = { id: '6', kind: 'other', listId: 'l' };
    // @ts-expect-error putItem requires itemId
    const missing: OutboxMutation = {
      id: '7',
      kind: 'putItem',
      listId: 'l',
      body: item,
    };
    const wrong: OutboxMutation = {
      id: '8',
      kind: 'deleteList',
      listId: 'l',
      // @ts-expect-error deleteList requires changedAt, not body
      body: put,
    };
    expect(all.map((m) => m.kind)).toEqual([
      'putList',
      'deleteList',
      'putItem',
      'deleteItem',
      'deleteItems',
    ]);
    expect([badKind, missing, wrong]).toHaveLength(3);
  });

  it('requires deletedAt to be string or null', () => {
    const list: ShoppingList = {
      id: 'i',
      name: 'n',
      version: 1,
      updatedAt: 'u',
      // @ts-expect-error undefined is not assignable to string | null
      deletedAt: undefined,
    };
    expect(list.deletedAt).toBeUndefined();
  });
});
