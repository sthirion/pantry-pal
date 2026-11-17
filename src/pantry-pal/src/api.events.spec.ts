import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nameKey } from '@pantry-pal/shared';
import { eq } from 'drizzle-orm';
import { createHousehold, createUser } from './admin-commands.js';
import { ORIGIN, useHarness } from './api.harness.js';
import { householdMember, shoppingList } from './db/schema.js';
import { HouseholdEventHub } from './realtime/household-event-hub.js';

const PASSWORD = 'correct horse';
const UNAUTHENTICATED =
  '{"error":{"code":"unauthenticated","message":"Authentication required."}}';
const FORBIDDEN = '{"error":{"code":"forbidden","message":"Forbidden."}}';
const KEEP_ALIVE_MS = 25_000;
const READ_TIMEOUT_MS = 5_000;

const LIST_1 = '0192f0c2-0000-7000-8000-00000000000a';
const LIST_2 = '0192f0c2-0000-7000-8000-00000000000b';
const itemId = (n: number) =>
  `0192f0c3-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const prompt = (pw: string) => () => Promise.resolve(pw);

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1) % 250}`;

/** Hub that tracks how many subscriptions are currently active. */
class CountingHub extends HouseholdEventHub {
  active = 0;

  override subscribe(
    householdId: string,
    listener: (version: number) => void,
  ): () => void {
    this.active += 1;
    const off = super.subscribe(householdId, listener);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active -= 1;
      }
      off();
    };
  }
}

interface Stream {
  res: Response;
  /** Reads until `text` arrives; rejects after `timeoutMs`. Returns everything received so far. */
  readUntil: (text: string, timeoutMs?: number) => Promise<string>;
  /** Everything received so far, after waiting `ms`. */
  collectFor: (ms: number) => Promise<string>;
  close: () => void;
}

type Who = 'a1' | 'a2' | 'b1' | 'n1';

describe('Events API (GET /api/events)', () => {
  const hub = new CountingHub();
  const ctx = useHarness({ eventHub: hub });
  const cookies = new Map<Who, string>();
  const open: Stream[] = [];
  let h1: string;
  let h2: string;

  beforeEach(() => {
    cookies.clear();
    h1 = createHousehold(ctx.h.db, { name: 'Household One' });
    h2 = createHousehold(ctx.h.db, { name: 'Household Two' });
    seedList(LIST_1, h1);
    seedList(LIST_2, h2);
  });

  afterEach(() => {
    open.splice(0).forEach((s) => s.close());
  });

  function seedList(id: string, householdId: string) {
    ctx.h.db
      .insert(shoppingList)
      .values({
        id,
        householdId,
        name: 'Groceries',
        nameKey: nameKey('Groceries'),
        version: 0,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      })
      .run();
  }

  async function cookieFor(who: Who): Promise<string> {
    const cached = cookies.get(who);
    if (cached) return cached;
    const email = `${who}@test.com`;
    const userId = await createUser(
      ctx.h.db,
      {
        email,
        name: who,
        household: who === 'b1' ? h2 : h1,
      },
      prompt(PASSWORD),
    );
    const res = await ctx.get('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': nextIp(),
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    if (who === 'n1') {
      ctx.h.db
        .delete(householdMember)
        .where(eq(householdMember.userId, userId))
        .run();
    }
    cookies.set(who, cookie);
    return cookie;
  }

  async function connect(who: Who | null): Promise<Stream> {
    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (who) headers.Cookie = await cookieFor(who);
    const res = await ctx.get('/api/events', {
      headers,
      signal: controller.signal,
    });
    const decoder = new TextDecoder();
    const reader = res.body?.getReader();
    let received = '';
    let pending: ReturnType<NonNullable<typeof reader>['read']> | null = null;

    const pump = async (deadline: number, text?: string) => {
      while (reader && (text === undefined || !received.includes(text))) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        pending ??= reader.read();
        const timeout = new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), remaining),
        );
        const result = await Promise.race([pending, timeout]);
        if (result === 'timeout') break;
        pending = null;
        if (result.done) break;
        received += decoder.decode(result.value);
      }
    };

    const stream: Stream = {
      res,
      readUntil: async (text, timeoutMs = READ_TIMEOUT_MS) => {
        await pump(Date.now() + timeoutMs, text);
        if (!received.includes(text)) {
          throw new Error(`Timed out waiting for "${text}"; got: ${received}`);
        }
        return received;
      },
      collectFor: async (ms) => {
        await pump(Date.now() + ms);
        return received;
      },
      close: () => controller.abort(),
    };
    open.push(stream);
    return stream;
  }

  /** Applies a real write as `who`, which publishes its version to the household's stream. */
  async function putItem(who: Who, listId: string, n: number) {
    const res = await ctx.get(`/api/lists/${listId}/items/${itemId(n)}`, {
      method: 'PUT',
      headers: {
        Cookie: await cookieFor(who),
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Item ${n}`,
        crossedOff: false,
        changedAt: new Date().toISOString(),
      }),
    });
    expect(res.status).toBeLessThan(300);
    return res;
  }

  const versions = (text: string) =>
    [...text.matchAll(/event: changed\ndata: (\d+)/g)].map((m) => Number(m[1]));

  async function waitForActive(count: number) {
    const deadline = Date.now() + READ_TIMEOUT_MS;
    while (hub.active !== count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(hub.active).toBe(count);
  }

  describe('basic functionality', () => {
    it('GetEvents_WithHouseholdSession_Returns200WithEventStreamHeaders', async () => {
      // Given
      const stream = await connect('a1');

      // When
      const res = stream.res;

      // Then
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('GetEvents_AfterItemWrite_StreamsChangedEventWithVersion', async () => {
      // Given
      const stream = await connect('a1');
      await waitForActive(1);

      // When
      await putItem('a1', LIST_1, 1);
      const text = await stream.readUntil('data: ');

      // Then
      expect(text).toContain('event: changed');
      expect(versions(text)).toHaveLength(1);
      expect(versions(text)[0]).toBeGreaterThan(0);
    });
  });

  describe('authentication', () => {
    it('GetEvents_WithoutSession_Returns401', async () => {
      // Given / When
      const res = await ctx.get('/api/events');

      // Then
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(UNAUTHENTICATED);
      expect(hub.active).toBe(0);
    });

    it('GetEvents_WithInvalidSessionCookie_Returns401', async () => {
      // Given / When
      const res = await ctx.get('/api/events', {
        headers: { Cookie: 'better-auth.session_token=bogus' },
      });

      // Then
      expect(res.status).toBe(401);
      expect(hub.active).toBe(0);
    });

    it('GetEvents_WhenUserHasNoHousehold_Returns403', async () => {
      // Given
      const cookie = await cookieFor('n1');

      // When
      const res = await ctx.get('/api/events', { headers: { Cookie: cookie } });

      // Then
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(hub.active).toBe(0);
    });
  });

  describe('broadcasting', () => {
    it('GetEvents_WhenHouseholdMemberWrites_DeliversEventToOtherMember', async () => {
      // Given
      const a1 = await connect('a1');
      const a2 = await connect('a2');
      await waitForActive(2);

      // When
      await putItem('a1', LIST_1, 1);
      const seenByA1 = await a1.readUntil('data: ');
      const seenByA2 = await a2.readUntil('data: ');

      // Then
      expect(versions(seenByA2)).toHaveLength(1);
      expect(versions(seenByA2)).toEqual(versions(seenByA1));
    });

    it('GetEvents_WhenSeveralWritesHappen_DeliversVersionsInIncreasingOrder', async () => {
      // Given
      const stream = await connect('a1');
      await waitForActive(1);

      // When
      await putItem('a1', LIST_1, 1);
      await putItem('a2', LIST_1, 2);
      await putItem('a1', LIST_1, 3);
      let seen = versions(await stream.readUntil('data: '));
      const deadline = Date.now() + READ_TIMEOUT_MS;
      while (seen.length < 3 && Date.now() < deadline) {
        seen = versions(await stream.collectFor(100));
      }

      // Then
      expect(seen).toHaveLength(3);
      expect(seen).toEqual([...seen].sort((x, y) => x - y));
      expect(new Set(seen).size).toBe(3);
    });
  });

  describe('household isolation', () => {
    it('GetEvents_WhenOtherHouseholdWrites_DoesNotDeliverEvent', async () => {
      // Given
      const a1 = await connect('a1');
      const b1 = await connect('b1');
      await waitForActive(2);

      // When
      await putItem('b1', LIST_2, 1);
      const seenByB1 = await b1.readUntil('data: ');
      const seenByA1 = await a1.collectFor(500);

      // Then
      expect(versions(seenByB1)).toHaveLength(1);
      expect(seenByA1).not.toContain('event: changed');
    });

    it('GetEvents_WhenBothHouseholdsWrite_EachSeesOnlyItsOwnVersion', async () => {
      // Given
      const a1 = await connect('a1');
      const b1 = await connect('b1');
      await waitForActive(2);

      // When
      await putItem('a1', LIST_1, 1);
      await putItem('b1', LIST_2, 2);
      const seenByA1 = await a1.readUntil('data: ');
      const seenByB1 = await b1.readUntil('data: ');
      const afterA1 = versions(await a1.collectFor(300));
      const afterB1 = versions(await b1.collectFor(300));

      // Then
      expect(afterA1).toHaveLength(1);
      expect(afterB1).toHaveLength(1);
      expect(versions(seenByA1)).not.toEqual(versions(seenByB1));
    });
  });

  describe('keep-alive', () => {
    it(
      'GetEvents_WhenIdle_SendsKeepAliveCommentEvery25Seconds',
      { timeout: 40_000 },
      async () => {
        // Given
        const stream = await connect('a1');
        const startedAt = Date.now();

        // When
        const text = await stream.readUntil(': keep-alive\n\n', 30_000);
        const elapsed = Date.now() - startedAt;

        // Then
        expect(text).toContain(': keep-alive\n\n');
        expect(elapsed).toBeGreaterThanOrEqual(KEEP_ALIVE_MS - 1_000);
        expect(elapsed).toBeLessThan(KEEP_ALIVE_MS + 4_000);
        expect(text).not.toContain('event: changed');
      },
    );
  });

  describe('connection management', () => {
    it('GetEvents_WhenClientDisconnects_UnsubscribesFromHub', async () => {
      // Given
      const stream = await connect('a1');
      await waitForActive(1);

      // When
      stream.close();

      // Then
      await waitForActive(0);
    });

    it('GetEvents_WhenOneOfTwoClientsDisconnects_KeepsOtherSubscribed', async () => {
      // Given
      const a1 = await connect('a1');
      const a2 = await connect('a2');
      await waitForActive(2);

      // When
      a1.close();
      await waitForActive(1);
      await putItem('a2', LIST_1, 1);
      const text = await a2.readUntil('data: ');

      // Then
      expect(versions(text)).toHaveLength(1);
    });
  });

  describe('reconnection', () => {
    it('GetEvents_AfterReconnect_ReceivesNewEvents', async () => {
      // Given
      const first = await connect('a1');
      await waitForActive(1);
      first.close();
      await waitForActive(0);

      // When
      const second = await connect('a1');
      await waitForActive(1);
      await putItem('a2', LIST_1, 1);
      const text = await second.readUntil('data: ');

      // Then
      expect(second.res.status).toBe(200);
      expect(versions(text)).toHaveLength(1);
    });

    it('GetEvents_AfterReconnect_DoesNotReplayEventsMissedWhileDisconnected', async () => {
      // Given
      const first = await connect('a1');
      await waitForActive(1);
      first.close();
      await waitForActive(0);
      await putItem('a2', LIST_1, 1);

      // When
      const second = await connect('a1');
      await waitForActive(1);
      const text = await second.collectFor(500);

      // Then
      expect(text).not.toContain('event: changed');
    });
  });
});
