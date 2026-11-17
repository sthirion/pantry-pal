import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth.js';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import { household, householdMember, user } from '../db/schema.js';
import { handleError, notFoundResponse } from '../errors.js';
import { HouseholdEventHub } from '../realtime/household-event-hub.js';
import { registerEventRoutes } from './events.js';

const fakeAuth = {
  api: {
    getSession: ({ headers }: { headers: Headers }) => {
      const id = headers.get('x-user');
      return Promise.resolve({
        response: id
          ? { user: { id, name: id, email: `${id}@example.com` } }
          : null,
        headers: new Headers(),
      });
    },
  },
} as unknown as Auth;

let db: AppDatabase;
let hub: HouseholdEventHub;
let app: Hono;

function build(keepAliveMs?: number): void {
  app = new Hono();
  registerEventRoutes(app, { auth: fakeAuth, db, hub, keepAliveMs });
  app.notFound(notFoundResponse);
  app.onError(handleError);
}

/** Reads from the stream until `text` has been received (or fails after a timeout). */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  text: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value);
  }
  return received;
}

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  const stamp = new Date(1);
  for (const id of ['u1', 'u2', 'u3']) {
    db.insert(user)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
  }
  db.insert(household)
    .values([
      { id: 'h1', name: 'One', createdAt: 1 },
      { id: 'h2', name: 'Two', createdAt: 1 },
    ])
    .run();
  db.insert(householdMember)
    .values([
      { householdId: 'h1', userId: 'u1', role: 'owner', createdAt: 1 },
      { householdId: 'h2', userId: 'u2', role: 'member', createdAt: 1 },
    ])
    .run();
  hub = new HouseholdEventHub();
  build();
});

describe('GET /api/events', () => {
  it('rejects a request without a session with 401', async () => {
    const res = await app.request('/api/events');
    expect(res.status).toBe(401);
  });

  it('rejects a user without a household with 403', async () => {
    const res = await app.request('/api/events', {
      headers: { 'x-user': 'u3' },
    });
    expect(res.status).toBe(403);
  });

  it('opens an event stream with no-cache and no proxy buffering', async () => {
    const res = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    await res.body?.cancel();
  });

  it('streams a changed event with the version for the same household', async () => {
    const res = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    const reader = res.body!.getReader();
    hub.publish('h1', 42);
    const text = await readUntil(reader, 'data: 42');
    expect(text).toContain('event: changed');
    expect(text).toContain('data: 42');
    await reader.cancel();
  });

  it('does not deliver events from another household', async () => {
    const res = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    const reader = res.body!.getReader();
    hub.publish('h2', 99);
    hub.publish('h1', 5);
    const text = await readUntil(reader, 'data: 5');
    expect(text).toContain('data: 5');
    expect(text).not.toContain('99');
    await reader.cancel();
  });

  it('sends a keep-alive comment while idle', async () => {
    build(10);
    const res = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    const reader = res.body!.getReader();
    const text = await readUntil(reader, ': keep-alive');
    expect(text).toContain(': keep-alive\n\n');
    await reader.cancel();
  });

  it('uses a 25 second keep-alive interval by default', async () => {
    const { KEEP_ALIVE_INTERVAL_MS } = await import('./events.js');
    expect(KEEP_ALIVE_INTERVAL_MS).toBe(25_000);
  });

  it('unsubscribes from the hub when the client disconnects', async () => {
    const unsubscribe = vi.fn();
    const subscribe = hub.subscribe.bind(hub);
    vi.spyOn(hub, 'subscribe').mockImplementation((id, listener) => {
      const off = subscribe(id, listener);
      return () => {
        unsubscribe();
        off();
      };
    });
    const res = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    const reader = res.body!.getReader();
    await reader.cancel();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled());
  });

  it('delivers current events to a client that reconnects', async () => {
    const first = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    await first.body!.cancel();
    const second = await app.request('/api/events', {
      headers: { 'x-user': 'u1' },
    });
    const reader = second.body!.getReader();
    hub.publish('h1', 8);
    expect(await readUntil(reader, 'data: 8')).toContain('data: 8');
    await reader.cancel();
  });
});
