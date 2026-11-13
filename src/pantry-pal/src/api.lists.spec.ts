import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nameKey } from '@pantry-pal/shared';
import { createHousehold, createUser } from './admin-commands.js';
import { ORIGIN, useHarness } from './api.harness.js';
import {
  changeCounter,
  householdMember,
  listItem,
  shoppingList,
} from './db/schema.js';
import { HouseholdEventHub } from './realtime/household-event-hub.js';

const PASSWORD = 'correct horse';
const FORBIDDEN = '{"error":{"code":"forbidden","message":"Forbidden."}}';
const UNAUTHENTICATED =
  '{"error":{"code":"unauthenticated","message":"Authentication required."}}';
const NAME_TAKEN =
  '{"error":{"code":"name_taken","message":"Name is already in use."}}';
const INTERNAL =
  '{"error":{"code":"internal_error","message":"An unexpected error occurred."}}';
const NOT_FOUND = '{"error":{"code":"not_found","message":"Not found."}}';
const NAME_LENGTH = 'Must be 1 to 100 characters.';

// Server clock fixed at 2026-11-13T12:00:00.000Z; every timestamp below is relative to it.
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const minutes = (n: number) => NOW + n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const STORED = minutes(-60);
const NEWER = iso(minutes(-30));
const OLDER = iso(minutes(-120));
const FUTURE = iso(minutes(60));

const LIST_ID = '0192f0c2-0000-7000-8000-00000000000a';
const OTHER_ID = '0192f0c2-0000-7000-8000-00000000000b';
const THIRD_ID = '0192f0c2-0000-7000-8000-00000000000c';
const MISSING_ID = '0192f0c2-0000-7000-8000-0000000000ff';
const ITEM_1 = '0192f0c2-0000-7000-8000-000000000101';
const ITEM_2 = '0192f0c2-0000-7000-8000-000000000102';

const prompt = (pw: string) => () => Promise.resolve(pw);

let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter += 1) % 250}`;

const hub = new HouseholdEventHub();
const unsubscribers: Array<() => void> = [];

function watch(householdId: string): number[] {
  const versions: number[] = [];
  unsubscribers.push(
    hub.subscribe(householdId, (version) => versions.push(version)),
  );
  return versions;
}

function shoppingListJson(
  id: string,
  name: string,
  version: number,
  updatedAt: string,
  deletedAt: string | null = null,
) {
  return { id, name, version, updatedAt, deletedAt };
}

function validation(...details: Array<{ path: string; message?: string }>) {
  return {
    error: {
      code: 'validation_failed',
      message: 'Request is invalid.',
      details: details.map((d) => ({
        path: d.path,
        message: d.message ?? expect.any(String),
      })),
    },
  };
}

interface Send {
  cookie?: string;
  /** `null` omits the header. */
  origin?: string | null;
  site?: string;
  body?: unknown;
  raw?: string;
  contentType?: string;
}

describe('Lists API', () => {
  const ctx = useHarness({ eventHub: hub, now: () => NOW });

  let h1: string;
  let h2: string;
  let userA: string;
  let cookieA: string;
  let cookieB: string;

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  function call(method: string, path: string, o: Send = {}) {
    const headers: Record<string, string> = {};
    if (o.cookie) headers.Cookie = o.cookie;
    if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
    if (o.site) headers['Sec-Fetch-Site'] = o.site;
    let body: string | undefined;
    if (o.raw !== undefined) body = o.raw;
    else if (o.body !== undefined) body = JSON.stringify(o.body);
    if (body !== undefined) {
      headers['Content-Type'] = o.contentType ?? 'application/json';
    }
    return ctx.get(path, { method, headers, body });
  }

  const put = (id: string, o: Send) => call('PUT', `/api/lists/${id}`, o);

  function del(id: string, changedAt: string | undefined, o: Send = {}) {
    const query =
      changedAt === undefined
        ? ''
        : `?changedAt=${encodeURIComponent(changedAt)}`;
    return call('DELETE', `/api/lists/${id}${query}`, o);
  }

  async function seedMember(
    email: string,
    householdId: string,
    role: 'owner' | 'member',
  ) {
    const userId = await createUser(
      ctx.h.db,
      { email, name: email.split('@')[0], household: householdId },
      prompt(PASSWORD),
    );
    if (role === 'owner') {
      ctx.h.db
        .update(householdMember)
        .set({ role })
        .where(eq(householdMember.userId, userId))
        .run();
    }
    const membership = ctx.h.db
      .select()
      .from(householdMember)
      .where(eq(householdMember.userId, userId))
      .get();
    expect(membership).toMatchObject({ householdId, userId, role });
    return userId;
  }

  async function signIn(email: string, householdId: string) {
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
    const me = await ctx.get('/api/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).household.id).toBe(householdId);
    return cookie;
  }

  beforeEach(async () => {
    h1 = createHousehold(ctx.h.db, { name: 'Household One' });
    h2 = createHousehold(ctx.h.db, { name: 'Household Two' });
    userA = await seedMember('a1@test.com', h1, 'owner');
    await seedMember('b1@test.com', h2, 'member');
    cookieA = await signIn('a1@test.com', h1);
    cookieB = await signIn('b1@test.com', h2);
  });

  const counter = () =>
    ctx.h.db.select().from(changeCounter).where(eq(changeCounter.id, 1)).get()!
      .value;

  const row = (id: string) =>
    ctx.h.db.select().from(shoppingList).where(eq(shoppingList.id, id)).get();

  const itemRow = (id: string) =>
    ctx.h.db.select().from(listItem).where(eq(listItem.id, id)).get();

  function snapshot() {
    const byId = <T extends { id: string }>(a: T, b: T) =>
      a.id.localeCompare(b.id);
    return {
      lists: ctx.h.db.select().from(shoppingList).all().sort(byId),
      items: ctx.h.db.select().from(listItem).all().sort(byId),
      counter: counter(),
    };
  }

  function seedList(o: {
    id?: string;
    householdId?: string;
    name?: string;
    updatedAt?: number;
    deletedAt?: number | null;
  }) {
    const id = o.id ?? LIST_ID;
    const name = o.name ?? 'Groceries';
    const version = counter() + 1;
    ctx.h.db
      .insert(shoppingList)
      .values({
        id,
        householdId: o.householdId ?? h1,
        name,
        nameKey: nameKey(name),
        version,
        createdAt: STORED,
        updatedAt: o.updatedAt ?? STORED,
        deletedAt: o.deletedAt ?? null,
      })
      .run();
    ctx.h.db
      .update(changeCounter)
      .set({ value: version })
      .where(eq(changeCounter.id, 1))
      .run();
    return id;
  }

  function seedItem(
    id: string,
    listId: string,
    householdId: string,
    deletedAt: number | null = null,
  ) {
    ctx.h.db
      .insert(listItem)
      .values({
        id,
        householdId,
        listId,
        name: `Item ${id.slice(-3)}`,
        nameKey: `item ${id.slice(-3)}`,
        crossedOffAt: null,
        version: 1,
        createdAt: STORED,
        updatedAt: STORED,
        deletedAt,
      })
      .run();
  }

  describe('PUT /api/lists/:listId create', () => {
    it('with a valid body returns 201 with the list contract and publishes the version', async () => {
      // Given a member of household one and a subscriber on it
      const events = watch(h1);

      // When they create a list with an unnormalized name and an offset changedAt
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: {
          name: '  Weekly   Shop ',
          changedAt: '2026-11-13T13:00:00+02:00',
        },
      });

      // Then the response follows the ShoppingList envelope with millisecond UTC timestamps
      expect(res.status).toBe(201);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json();
      expect(body).toEqual({
        list: shoppingListJson(
          LIST_ID,
          'Weekly Shop',
          1,
          '2026-11-13T11:00:00.000Z',
        ),
        applied: true,
      });
      expect(body).not.toHaveProperty('mergedFromId');
      expect(row(LIST_ID)).toMatchObject({
        householdId: h1,
        nameKey: 'weekly shop',
        updatedAt: STORED,
        deletedAt: null,
      });
      expect(counter()).toBe(1);
      expect(events).toEqual([1]);
    });

    it('with an identical replay returns 200 applied false without a new version or event', async () => {
      // Given a created list
      const events = watch(h1);
      const body = { name: 'Weekly Shop', changedAt: iso(STORED) };
      const first = await put(LIST_ID, { cookie: cookieA, body });
      expect(first.status).toBe(201);
      const before = snapshot();

      // When the identical request is replayed
      const res = await put(LIST_ID, { cookie: cookieA, body });

      // Then the stored projection is returned and nothing changes
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Weekly Shop', 1, iso(STORED)),
        applied: false,
      });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([1]);
    });

    it('with a newer identical-name replay returns 200 applied false without a new version', async () => {
      // Given a created list
      const events = watch(h1);
      await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Weekly Shop', changedAt: iso(STORED) },
      });
      const before = snapshot();

      // When the same name is sent with a newer changedAt
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Weekly Shop', changedAt: NEWER },
      });

      // Then it is still an idempotent replay
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([1]);
    });

    it('as an owner and as a member creates a list in their own household', async () => {
      // Given an owner in household one and a member in household two
      expect(
        ctx.h.db
          .select()
          .from(householdMember)
          .where(eq(householdMember.userId, userA))
          .get()?.role,
      ).toBe('owner');

      // When each creates a list
      const owner = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Owner List', changedAt: iso(STORED) },
      });
      const member = await put(OTHER_ID, {
        cookie: cookieB,
        body: { name: 'Member List', changedAt: iso(STORED) },
      });

      // Then both succeed and each list belongs to its caller's household
      expect(owner.status).toBe(201);
      expect(member.status).toBe(201);
      expect(row(LIST_ID)?.householdId).toBe(h1);
      expect(row(OTHER_ID)?.householdId).toBe(h2);
    });

    it('ignores a client-supplied household id and uses the session household', async () => {
      // Given a member of household one
      // When they attempt to name another household in headers, query and body
      const res = await call('PUT', `/api/lists/${LIST_ID}?householdId=${h2}`, {
        cookie: cookieA,
        body: { name: 'Mine', changedAt: iso(STORED), householdId: h2 },
      });

      // Then the list is stored under the caller's household
      expect(res.status).toBe(201);
      expect(row(LIST_ID)?.householdId).toBe(h1);
    });

    it('with name text that looks like SQL stores it as data', async () => {
      // Given a name containing SQL
      const name = "x'); DROP TABLE shopping_list;--";

      // When the list is created
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name, changedAt: iso(STORED) },
      });

      // Then the name is stored verbatim and the table still works
      expect(res.status).toBe(201);
      expect(row(LIST_ID)?.name).toBe(name);
    });
  });

  describe('PUT /api/lists/:listId validation', () => {
    it.each([
      ['1 character', 'a'],
      ['100 characters', 'a'.repeat(100)],
      ['100 characters after whitespace collapse', ` ${'a'.repeat(98)}    b `],
    ])('with a name of %s returns 201', async (_label, name) => {
      // Given a boundary-length name
      // When the list is created
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name, changedAt: iso(STORED) },
      });

      // Then it is accepted with the normalized name
      expect(res.status).toBe(201);
      const stored = (await res.json()).list.name as string;
      expect(stored).toBe(name.replace(/\s+/g, ' ').trim());
      expect(stored.length).toBeGreaterThanOrEqual(1);
      expect(stored.length).toBeLessThanOrEqual(100);
    });

    it.each([
      ['an empty name', ''],
      ['a whitespace-only name', ' \t  '],
      ['a 101-character name', 'a'.repeat(101)],
      ['a name that is 101 after normalization', `${'a'.repeat(99)}   b`],
    ])('with %s returns 400 and creates nothing', async (_label, name) => {
      // Given an out-of-range name
      const events = watch(h1);

      // When the list is created
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name, changedAt: iso(STORED) },
      });

      // Then validation fails on the name and nothing is written
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        validation({ path: 'name', message: NAME_LENGTH }),
      );
      expect(snapshot()).toEqual({ lists: [], items: [], counter: 0 });
      expect(events).toEqual([]);
    });

    it.each([
      ['a missing name', { changedAt: iso(STORED) }],
      ['a numeric name', { name: 5, changedAt: iso(STORED) }],
      ['a null name', { name: null, changedAt: iso(STORED) }],
    ])('with %s returns 400 for name', async (_label, body) => {
      // Given a body without a usable name
      // When the list is created
      const res = await put(LIST_ID, { cookie: cookieA, body });

      // Then the name path is reported
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(validation({ path: 'name' }));
      expect(snapshot().lists).toEqual([]);
    });

    it.each([
      ['missing', undefined],
      ['free text', 'yesterday'],
      ['a date without time', '2026-11-13'],
      ['a time without offset', '2026-11-13T11:00:00'],
      ['an impossible date', '2026-13-45T11:00:00Z'],
      ['a number', 1763031600000],
      ['null', null],
    ])('with changedAt %s returns 400 for changedAt', async (_label, value) => {
      // Given a malformed changedAt
      const body: Record<string, unknown> = { name: 'Groceries' };
      if (value !== undefined) body.changedAt = value;

      // When the list is created
      const res = await put(LIST_ID, { cookie: cookieA, body });

      // Then the changedAt path is reported and nothing is written
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(validation({ path: 'changedAt' }));
      expect(snapshot()).toEqual({ lists: [], items: [], counter: 0 });
    });

    it.each(['not-a-uuid', '123', `${LIST_ID}0`])(
      'with path id %s returns 400 for listId',
      async (id) => {
        // Given a malformed path id
        // When the list is created
        const res = await put(id, {
          cookie: cookieA,
          body: { name: 'Groceries', changedAt: iso(STORED) },
        });

        // Then the listId path is reported and nothing is written
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(validation({ path: 'listId' }));
        expect(snapshot()).toEqual({ lists: [], items: [], counter: 0 });
      },
    );

    it('with several invalid inputs reports every failing path', async () => {
      // Given an invalid id, name and changedAt
      // When the list is created
      const res = await put('not-a-uuid', {
        cookie: cookieA,
        body: { name: '', changedAt: 'nope' },
      });

      // Then each input has its own detail
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        validation(
          { path: 'listId' },
          { path: 'name', message: NAME_LENGTH },
          { path: 'changedAt' },
        ),
      );
    });

    it.each([
      ['invalid JSON', { raw: '{not json' }],
      ['a non-JSON content type', { raw: '{}', contentType: 'text/plain' }],
      ['a JSON value that is not an object', { raw: '[]' }],
    ])('with %s returns 400 with a root-path detail', async (_label, extra) => {
      // Given a body that is not a JSON object
      // When the list is created
      const res = await put(LIST_ID, { cookie: cookieA, ...extra });

      // Then validation fails and nothing is written
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('validation_failed');
      expect(body.error.details.length).toBeGreaterThanOrEqual(1);
      expect(snapshot().lists).toEqual([]);
    });

    it('with invalid JSON reports a root path', async () => {
      // Given malformed JSON
      // When the list is created
      const res = await put(LIST_ID, { cookie: cookieA, raw: '{not json' });

      // Then the detail path is the document root
      expect(await res.json()).toEqual(validation({ path: '' }));
    });

    it('with validation errors does not leak internals', async () => {
      // Given an invalid request
      // When it is sent
      const res = await put('not-a-uuid', {
        cookie: cookieA,
        raw: '{not json',
      });

      // Then the body carries no stack, SQL or file paths
      const text = await res.text();
      expect(text).not.toMatch(
        /stack|sqlite|select |insert |\.ts|node_modules/i,
      );
    });
  });

  describe('PUT /api/lists/:listId rename and last-write-wins', () => {
    it('with a newer changedAt renames, increments the version and publishes it', async () => {
      // Given a stored list and a subscriber
      seedList({});
      const events = watch(h1);

      // When it is renamed with a newer changedAt
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: NEWER },
      });

      // Then the rename is applied with the next shared version
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Renamed', 2, NEWER),
        applied: true,
      });
      expect(counter()).toBe(2);
      expect(events).toEqual([2]);
    });

    it('with a changedAt equal to the stored instant applies the rename', async () => {
      // Given a stored list
      seedList({});
      const events = watch(h1);

      // When a different name arrives with the stored instant
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: iso(STORED) },
      });

      // Then equality is applied
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Renamed', 2, iso(STORED)),
        applied: true,
      });
      expect(events).toEqual([2]);
    });

    it('with an equivalent instant in another offset applies the rename', async () => {
      // Given a list stored at 11:00Z
      seedList({});

      // When changedAt is 13:00+02:00, the same instant
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: '2026-11-13T13:00:00.000+02:00' },
      });

      // Then offsets compare as instants and it is applied
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
    });

    it('with an older changedAt returns 200 applied false and leaves everything unchanged', async () => {
      // Given a stored list and a subscriber
      seedList({});
      const events = watch(h1);
      const before = snapshot();

      // When an older rename arrives
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Stale name', changedAt: OLDER },
      });

      // Then the stored projection is returned and nothing changes
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Groceries', 1, iso(STORED)),
        applied: false,
      });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('with an older instant expressed in another offset is stale', async () => {
      // Given a list stored at 11:00Z
      seedList({});
      const before = snapshot();

      // When changedAt is 12:59+02:00, which is 10:59Z
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Stale name', changedAt: '2026-11-13T12:59:00+02:00' },
      });

      // Then the earlier instant is not applied
      expect((await res.json()).applied).toBe(false);
      expect(snapshot()).toEqual(before);
    });

    it('with only a case change applies the rename and keeps the key', async () => {
      // Given a list named groceries
      seedList({ name: 'groceries' });

      // When it is renamed to Groceries
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: NEWER },
      });

      // Then the display name changes without a self-conflict
      expect(res.status).toBe(200);
      expect((await res.json()).list.name).toBe('Groceries');
      expect(row(LIST_ID)?.nameKey).toBe('groceries');
    });

    it.each(['Market', ' market ', 'MARKET'])(
      'to a name %j used by another live list returns 409 and changes nothing',
      async (name) => {
        // Given two live lists in one household and a subscriber
        seedList({});
        seedList({ id: OTHER_ID, name: 'Market' });
        const events = watch(h1);
        const before = snapshot();

        // When the first is renamed to the second's name
        const res = await put(LIST_ID, {
          cookie: cookieA,
          body: { name, changedAt: NEWER },
        });

        // Then name_taken is returned and neither the row nor the counter moved
        expect(res.status).toBe(409);
        expect(await res.text()).toBe(NAME_TAKEN);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('to the name of a soft-deleted list in the household is applied', async () => {
      // Given a soft-deleted list named Market
      seedList({});
      seedList({ id: OTHER_ID, name: 'Market', deletedAt: STORED });

      // When the live list is renamed to Market
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Market', changedAt: NEWER },
      });

      // Then deleted lists do not conflict
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
    });

    it('to the name of a list in another household is applied', async () => {
      // Given household two owns a live list named Market
      seedList({});
      seedList({ id: OTHER_ID, name: 'Market', householdId: h2 });

      // When household one renames its list to Market
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Market', changedAt: NEWER },
      });

      // Then names are scoped per household
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
    });

    it('for a soft-deleted list with a newer changedAt restores it', async () => {
      // Given a soft-deleted list and a subscriber
      seedList({ deletedAt: STORED });
      const events = watch(h1);

      // When the same id is put with a newer changedAt
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: NEWER },
      });

      // Then it is restored with a new version
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Groceries', 2, NEWER),
        applied: true,
      });
      expect(row(LIST_ID)?.deletedAt).toBeNull();
      expect(events).toEqual([2]);
    });

    it('for a soft-deleted list with an equal changedAt restores it', async () => {
      // Given a soft-deleted list
      seedList({ deletedAt: STORED });

      // When the same id is put with the stored instant
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: iso(STORED) },
      });

      // Then equality restores it
      expect((await res.json()).applied).toBe(true);
      expect(row(LIST_ID)?.deletedAt).toBeNull();
    });

    it('for a soft-deleted list with an older changedAt returns the unchanged projection', async () => {
      // Given a soft-deleted list and a subscriber
      seedList({ deletedAt: STORED });
      const events = watch(h1);
      const before = snapshot();

      // When an older put arrives
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: OLDER },
      });

      // Then it stays deleted and nothing is published
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(
          LIST_ID,
          'Groceries',
          1,
          iso(STORED),
          iso(STORED),
        ),
        applied: false,
      });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('PUT /api/lists/:listId server-time clamp', () => {
    it('with a future changedAt on create stores server time', async () => {
      // Given a future client timestamp
      // When a list is created
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: FUTURE },
      });

      // Then updatedAt is the server clock
      expect(res.status).toBe(201);
      expect((await res.json()).list.updatedAt).toBe(iso(NOW));
      expect(row(LIST_ID)?.updatedAt).toBe(NOW);
    });

    it('with a future changedAt on rename stores server time', async () => {
      // Given a stored list
      seedList({});

      // When it is renamed with a future changedAt
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: FUTURE },
      });

      // Then the write applies at server time
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.list.updatedAt).toBe(iso(NOW));
    });

    it('with a changedAt equal to server time is accepted unclamped', async () => {
      // Given a stored list older than now
      seedList({});

      // When a write arrives exactly at server time
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: iso(NOW) },
      });

      // Then it applies and updatedAt is that instant
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.list.updatedAt).toBe(iso(NOW));
    });

    it('with a changedAt one millisecond after server time is clamped to server time', async () => {
      // Given a stored list
      seedList({});

      // When a write is one millisecond in the future
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: iso(NOW + 1) },
      });

      // Then updatedAt is server time
      expect((await res.json()).list.updatedAt).toBe(iso(NOW));
    });
  });

  describe('PUT /api/lists/:listId same-name merge', () => {
    it('with an equal changedAt merges into the existing list, keeps its casing and publishes', async () => {
      // Given a live list named Market and a subscriber
      seedList({ name: 'Market' });
      const events = watch(h1);

      // When another id is created as " market " at the stored instant
      const res = await put(OTHER_ID, {
        cookie: cookieA,
        body: { name: ' market ', changedAt: iso(STORED) },
      });

      // Then the existing row is returned and applied with a new version
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Market', 2, iso(STORED)),
        applied: true,
        mergedFromId: OTHER_ID,
      });
      expect(row(OTHER_ID)).toBeUndefined();
      expect(row(LIST_ID)).toMatchObject({ name: 'Market', nameKey: 'market' });
      expect(counter()).toBe(2);
      expect(events).toEqual([2]);
    });

    it('with a newer changedAt merges and advances updatedAt and version', async () => {
      // Given a live list named Market and a subscriber
      seedList({ name: 'Market' });
      const events = watch(h1);

      // When a newer same-name create arrives
      const res = await put(OTHER_ID, {
        cookie: cookieA,
        body: { name: 'market', changedAt: NEWER },
      });

      // Then the existing list is updated in place
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Market', 2, NEWER),
        applied: true,
        mergedFromId: OTHER_ID,
      });
      expect(row(OTHER_ID)).toBeUndefined();
      expect(events).toEqual([2]);
    });

    it('with an older changedAt returns applied false with no version, mutation or event', async () => {
      // Given a live list named Market and a subscriber
      seedList({ name: 'Market' });
      const events = watch(h1);
      const before = snapshot();

      // When an older same-name create arrives
      const res = await put(OTHER_ID, {
        cookie: cookieA,
        body: { name: ' market ', changedAt: OLDER },
      });

      // Then the unchanged row is returned and nothing moves
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Market', 1, iso(STORED)),
        applied: false,
        mergedFromId: OTHER_ID,
      });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('with a future changedAt compares the clamped time and applies', async () => {
      // Given a live list stored before server time
      seedList({ name: 'Market' });

      // When a same-name create carries a future changedAt
      const res = await put(OTHER_ID, {
        cookie: cookieA,
        body: { name: 'market', changedAt: FUTURE },
      });

      // Then the clamped server time is newer than the stored row and applies
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.list.updatedAt).toBe(iso(NOW));
    });

    it('with a future changedAt still stale after clamping returns applied false', async () => {
      // Given a live list stored after server time
      seedList({ name: 'Market', updatedAt: minutes(30) });
      const events = watch(h1);
      const before = snapshot();

      // When a future same-name create clamps to a time before the stored one
      const res = await put(OTHER_ID, {
        cookie: cookieA,
        body: { name: 'market', changedAt: FUTURE },
      });

      // Then it is ignored without a version or event
      expect((await res.json()).applied).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('with a live same-name list only in another household creates a new list', async () => {
      // Given only household two has a live list named Market
      seedList({ id: OTHER_ID, name: 'Market', householdId: h2 });
      const other = row(OTHER_ID);

      // When household one creates market
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'market', changedAt: NEWER },
      });

      // Then it gets its own list and the other household's row is untouched
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.list.id).toBe(LIST_ID);
      expect(body.list.name).toBe('market');
      expect(body).not.toHaveProperty('mergedFromId');
      expect(row(OTHER_ID)).toEqual(other);
    });

    it('with a soft-deleted same-name list only creates a new list and leaves the deleted one', async () => {
      // Given a soft-deleted list named Market
      seedList({ id: OTHER_ID, name: 'Market', deletedAt: STORED });
      const deleted = row(OTHER_ID);

      // When a different id is created as market
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'market', changedAt: NEWER },
      });

      // Then a new live list is created and the deleted one is not returned or modified
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.list.id).toBe(LIST_ID);
      expect(body).not.toHaveProperty('mergedFromId');
      expect(row(OTHER_ID)).toEqual(deleted);
    });
  });

  describe('household isolation', () => {
    it('PUT /api/lists/:listId for another household list returns 403 and changes nothing', async () => {
      // Given a list owned by household two and a subscriber on each household
      seedList({ householdId: h2 });
      const events1 = watch(h1);
      const events2 = watch(h2);
      const before = snapshot();

      // When household one puts that id
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Hijacked', changedAt: NEWER },
      });

      // Then it is forbidden, not merged, and no data is disclosed
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
      expect(events1).toEqual([]);
      expect(events2).toEqual([]);
    });

    it('PUT /api/lists/:listId for a soft-deleted other-household list returns 403', async () => {
      // Given household two's soft-deleted list
      seedList({ householdId: h2, deletedAt: STORED });
      const before = snapshot();

      // When household one puts that id
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Hijacked', changedAt: NEWER },
      });

      // Then it is forbidden and unchanged
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
    });

    it('DELETE /api/lists/:listId for another household list returns 403 and changes nothing', async () => {
      // Given household two's list with an item
      seedList({ householdId: h2 });
      seedItem(ITEM_1, LIST_ID, h2);
      const events = watch(h2);
      const before = snapshot();

      // When household one deletes it
      const res = await del(LIST_ID, NEWER, { cookie: cookieA });

      // Then it is forbidden rather than a 204 and nothing changes
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('DELETE /api/lists/:listId for a soft-deleted other-household list returns 403', async () => {
      // Given household two's soft-deleted list
      seedList({ householdId: h2, deletedAt: STORED });
      const before = snapshot();

      // When household one deletes it
      const res = await del(LIST_ID, NEWER, { cookie: cookieA });

      // Then it is forbidden, not idempotent success
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
    });

    it('PUT /api/lists/:listId for a user without a household returns 403', async () => {
      // Given a valid session whose membership was removed
      ctx.h.db
        .delete(householdMember)
        .where(eq(householdMember.userId, userA))
        .run();

      // When the user writes a list
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: iso(STORED) },
      });

      // Then it is forbidden and nothing is created
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot().lists).toEqual([]);
    });

    it('DELETE /api/lists/:listId for a user without a household returns 403', async () => {
      // Given a list and a session whose membership was removed
      seedList({});
      ctx.h.db
        .delete(householdMember)
        .where(eq(householdMember.userId, userA))
        .run();
      const before = snapshot();

      // When the user deletes it
      const res = await del(LIST_ID, NEWER, { cookie: cookieA });

      // Then it is forbidden and unchanged
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
    });
  });

  describe('DELETE /api/lists/:listId', () => {
    it('with a valid id soft-deletes the list and its live items in one transaction and returns 204', async () => {
      // Given a list with a live item, an already-deleted item and a subscriber
      seedList({});
      seedItem(ITEM_1, LIST_ID, h1);
      seedItem(ITEM_2, LIST_ID, h1, minutes(-90));
      const deletedItem = itemRow(ITEM_2);
      const events = watch(h1);

      // When it is deleted with a newer changedAt
      const res = await del(LIST_ID, NEWER, { cookie: cookieA });

      // Then 204 with no body, one new version stamped on the list and live items
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      const changedAt = Date.parse(NEWER);
      expect(row(LIST_ID)).toMatchObject({
        deletedAt: changedAt,
        updatedAt: changedAt,
        version: 2,
      });
      expect(itemRow(ITEM_1)).toMatchObject({
        deletedAt: changedAt,
        updatedAt: changedAt,
        version: 2,
      });
      expect(itemRow(ITEM_2)).toEqual(deletedItem);
      expect(counter()).toBe(2);
      expect(events).toEqual([2]);
    });

    it('with a changedAt equal to the stored instant deletes the list', async () => {
      // Given a stored list
      seedList({});

      // When it is deleted at the stored instant
      const res = await del(LIST_ID, iso(STORED), { cookie: cookieA });

      // Then equality is applied
      expect(res.status).toBe(204);
      expect(row(LIST_ID)?.deletedAt).toBe(STORED);
    });

    it('with a future changedAt stores server time', async () => {
      // Given a stored list
      seedList({});

      // When it is deleted with a future changedAt
      const res = await del(LIST_ID, FUTURE, { cookie: cookieA });

      // Then the deletion is stamped with server time
      expect(res.status).toBe(204);
      expect(row(LIST_ID)).toMatchObject({ deletedAt: NOW, updatedAt: NOW });
    });

    it('repeated returns 204 without a new version, change or event', async () => {
      // Given a deleted list and a subscriber
      seedList({});
      await del(LIST_ID, NEWER, { cookie: cookieA });
      const events = watch(h1);
      const before = snapshot();

      // When the delete is repeated, also with a later changedAt
      const first = await del(LIST_ID, NEWER, { cookie: cookieA });
      const later = await del(LIST_ID, iso(NOW), { cookie: cookieA });

      // Then both return 204 and nothing moves
      expect(first.status).toBe(204);
      expect(later.status).toBe(204);
      expect(await later.text()).toBe('');
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('for an already soft-deleted household list returns 204 and changes nothing', async () => {
      // Given a list soft-deleted before the request
      seedList({ deletedAt: STORED });
      const events = watch(h1);
      const before = snapshot();

      // When it is deleted
      const res = await del(LIST_ID, NEWER, { cookie: cookieA });

      // Then 204 and unchanged
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('for an id missing everywhere returns 204 and creates nothing', async () => {
      // Given no list with that id in any household
      const events = watch(h1);

      // When a valid unknown id is deleted
      const res = await del(MISSING_ID, NEWER, { cookie: cookieA });

      // Then it is idempotent success with no side effects
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(snapshot()).toEqual({ lists: [], items: [], counter: 0 });
      expect(events).toEqual([]);
    });

    it('with an older changedAt returns 200 applied false and leaves list and items unchanged', async () => {
      // Given a list with a live item and a subscriber
      seedList({});
      seedItem(ITEM_1, LIST_ID, h1);
      const events = watch(h1);
      const before = snapshot();

      // When an older delete arrives
      const res = await del(LIST_ID, OLDER, { cookie: cookieA });

      // Then the current list is returned and nothing changes
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        list: shoppingListJson(LIST_ID, 'Groceries', 1, iso(STORED)),
        applied: false,
      });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it.each(['not-a-uuid', '123', `${LIST_ID}0`])(
      'with path id %s returns 400 for listId and changes nothing',
      async (id) => {
        // Given a stored list
        seedList({});
        const before = snapshot();

        // When a malformed id is deleted
        const res = await del(id, NEWER, { cookie: cookieA });

        // Then only listId is reported
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(validation({ path: 'listId' }));
        expect(snapshot()).toEqual(before);
      },
    );

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['free text', 'yesterday'],
      ['a date without time', '2026-11-13'],
      ['a time without offset', '2026-11-13T11:00:00'],
    ])('with changedAt %s returns 400 for changedAt', async (_label, value) => {
      // Given a stored list and item
      seedList({});
      seedItem(ITEM_1, LIST_ID, h1);
      const before = snapshot();

      // When it is deleted with a bad changedAt
      const res = await del(LIST_ID, value, { cookie: cookieA });

      // Then changedAt is reported and nothing is deleted
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(validation({ path: 'changedAt' }));
      expect(snapshot()).toEqual(before);
    });

    it('with an invalid id and changedAt reports both paths', async () => {
      // Given neither input is valid
      // When the delete is sent
      const res = await del('not-a-uuid', undefined, { cookie: cookieA });

      // Then both details are returned
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        validation({ path: 'listId' }, { path: 'changedAt' }),
      );
    });

    it('rolls back the list update, version and event when the item update fails', async () => {
      // Given a list with a live item and a failing item-update trigger
      seedList({});
      seedItem(ITEM_1, LIST_ID, h1);
      ctx.h.sqlite.exec(
        `CREATE TRIGGER fail_item_update BEFORE UPDATE ON list_item
         BEGIN SELECT RAISE(ABORT, 'secret-trigger-detail'); END;`,
      );
      const events = watch(h1);
      const before = snapshot();

      // When the list is deleted
      const res = await del(LIST_ID, NEWER, { cookie: cookieA });

      // Then the request fails with a generic 500 and the whole transaction is rolled back
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toBe(INTERNAL);
      expect(text).not.toContain('secret-trigger-detail');
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('PUT /api/lists/:listId rollback', () => {
    it('rolls back the version when the rename write fails', async () => {
      // Given a list and a failing list-update trigger
      seedList({});
      ctx.h.sqlite.exec(
        `CREATE TRIGGER fail_list_update BEFORE UPDATE ON shopping_list
         BEGIN SELECT RAISE(ABORT, 'secret-trigger-detail'); END;`,
      );
      const events = watch(h1);
      const before = snapshot();

      // When the list is renamed
      const res = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: NEWER },
      });

      // Then a generic 500 is returned and the consumed version is rolled back
      expect(res.status).toBe(500);
      expect(await res.text()).toBe(INTERNAL);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('missing session', () => {
    it.each([
      ['a missing cookie', undefined],
      ['a garbage session cookie', 'better-auth.session_token=garbage'],
    ])(
      'PUT /api/lists/:listId with %s returns 401 with the full body',
      async (_label, cookie) => {
        // Given no valid session
        seedList({});
        const before = snapshot();

        // When a valid put is sent
        const res = await put(OTHER_ID, {
          cookie,
          body: { name: 'Groceries2', changedAt: NEWER },
        });

        // Then 401 with the exact unauthenticated body and no mutation
        expect(res.status).toBe(401);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.text()).toBe(UNAUTHENTICATED);
        expect(snapshot()).toEqual(before);
      },
    );

    it('PUT /api/lists/:listId with an invalid body and no session returns 401 not 400', async () => {
      // Given no session
      // When an invalid body is sent
      const res = await put('not-a-uuid', { raw: '{not json' });

      // Then authentication is checked before validation
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(UNAUTHENTICATED);
    });

    it.each([
      ['a missing cookie', undefined],
      ['a garbage session cookie', 'better-auth.session_token=garbage'],
    ])(
      'DELETE /api/lists/:listId with %s returns 401 with the full body',
      async (_label, cookie) => {
        // Given no valid session and a stored list
        seedList({});
        const events = watch(h1);
        const before = snapshot();

        // When a valid delete is sent
        const res = await del(LIST_ID, NEWER, { cookie });

        // Then 401 with the exact body and the list is untouched
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(UNAUTHENTICATED);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('DELETE /api/lists/:listId with an invalid id and no session returns 401 not 400', async () => {
      // Given no session
      // When an invalid delete is sent
      const res = await del('not-a-uuid', undefined);

      // Then authentication is checked before validation
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(UNAUTHENTICATED);
    });
  });

  describe('origin checks', () => {
    const rejected: Array<[string, Send]> = [
      ['a foreign Origin', { origin: 'https://evil.example' }],
      ['an Origin of null', { origin: 'null' }],
      ['an http Origin', { origin: 'http://pantry.thirion.org' }],
      [
        'no Origin and Sec-Fetch-Site cross-site',
        { origin: null, site: 'cross-site' },
      ],
    ];

    it.each(rejected)(
      'PUT /api/lists/:listId with %s returns 403 before body parsing or mutation',
      async (_label, extra) => {
        // Given a stored list and a subscriber
        seedList({});
        const events = watch(h1);
        const before = snapshot();

        // When a valid rename and an unparsable body are each sent
        const valid = await put(LIST_ID, {
          cookie: cookieA,
          body: { name: 'Renamed', changedAt: NEWER },
          ...extra,
        });
        const broken = await put(LIST_ID, {
          cookie: cookieA,
          raw: '{not json',
          ...extra,
        });

        // Then both get the exact forbidden body and nothing changes
        expect(valid.status).toBe(403);
        expect(await valid.text()).toBe(FORBIDDEN);
        expect(broken.status).toBe(403);
        expect(await broken.text()).toBe(FORBIDDEN);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it.each(rejected)(
      'DELETE /api/lists/:listId with %s returns 403 before validation or mutation',
      async (_label, extra) => {
        // Given a stored list with an item and a subscriber
        seedList({});
        seedItem(ITEM_1, LIST_ID, h1);
        const events = watch(h1);
        const before = snapshot();

        // When a valid delete and an invalid one are each sent
        const valid = await del(LIST_ID, NEWER, { cookie: cookieA, ...extra });
        const invalid = await del('not-a-uuid', undefined, {
          cookie: cookieA,
          ...extra,
        });

        // Then both are forbidden and the list and item are intact
        expect(valid.status).toBe(403);
        expect(await valid.text()).toBe(FORBIDDEN);
        expect(invalid.status).toBe(403);
        expect(await invalid.text()).toBe(FORBIDDEN);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('PUT /api/lists/:listId with a foreign Origin and no session returns 403 not 401', async () => {
      // Given no session
      // When a cross-origin put is sent
      const res = await put(LIST_ID, {
        origin: 'https://evil.example',
        body: { name: 'Groceries', changedAt: NEWER },
      });

      // Then the origin check runs first
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
    });

    it.each([
      ['no Origin and no Sec-Fetch-Site', { origin: null }],
      [
        'no Origin and Sec-Fetch-Site same-origin',
        { origin: null, site: 'same-origin' },
      ],
      [
        'the configured Origin and Sec-Fetch-Site cross-site',
        { site: 'cross-site' },
      ],
    ] as Array<[string, Send]>)(
      'PUT /api/lists/:listId with %s is accepted',
      async (_label, extra) => {
        // Given a request that satisfies the origin rule
        // When a list is created
        const res = await put(LIST_ID, {
          cookie: cookieA,
          body: { name: 'Groceries', changedAt: iso(STORED) },
          ...extra,
        });

        // Then it reaches the handler
        expect(res.status).toBe(201);
      },
    );
  });

  describe('event hub publication', () => {
    it('delivers each applied write version to every household subscriber only', async () => {
      // Given two subscribers on household one and one on household two
      const first = watch(h1);
      const second = watch(h1);
      const other = watch(h2);

      // When a list is created, renamed and deleted
      const created = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: iso(STORED) },
      });
      const renamed = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Renamed', changedAt: NEWER },
      });
      const deleted = await del(LIST_ID, iso(NOW), { cookie: cookieA });

      // Then both subscribers receive versions 1, 2 and 3 and household two none
      expect((await created.json()).list.version).toBe(1);
      expect((await renamed.json()).list.version).toBe(2);
      expect(deleted.status).toBe(204);
      expect(first).toEqual([1, 2, 3]);
      expect(second).toEqual([1, 2, 3]);
      expect(other).toEqual([]);
      expect(counter()).toBe(3);
    });

    it('publishes nothing for replay, stale, conflict, validation and forbidden requests', async () => {
      // Given two lists and subscribers on both households
      seedList({});
      seedList({ id: OTHER_ID, name: 'Market' });
      seedList({ id: THIRD_ID, name: 'Theirs', householdId: h2 });
      const events1 = watch(h1);
      const events2 = watch(h2);
      const before = snapshot();

      // When unapplied requests are sent
      const replay = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Groceries', changedAt: NEWER },
      });
      const stale = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Other', changedAt: OLDER },
      });
      const staleMerge = await put(MISSING_ID, {
        cookie: cookieA,
        body: { name: 'market', changedAt: OLDER },
      });
      const conflict = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: 'Market', changedAt: NEWER },
      });
      const invalid = await put(LIST_ID, {
        cookie: cookieA,
        body: { name: '', changedAt: NEWER },
      });
      const forbidden = await del(THIRD_ID, NEWER, { cookie: cookieA });
      const staleDelete = await del(LIST_ID, OLDER, { cookie: cookieA });

      // Then no version is assigned or published
      expect(
        [
          replay,
          stale,
          staleMerge,
          conflict,
          invalid,
          forbidden,
          staleDelete,
        ].map((r) => r.status),
      ).toEqual([200, 200, 200, 409, 400, 403, 200]);
      expect(snapshot()).toEqual(before);
      expect(events1).toEqual([]);
      expect(events2).toEqual([]);
    });
  });

  describe('unknown API routes', () => {
    it('GET /api/lists with a session returns 404 with the shared not_found body', async () => {
      // Given an authenticated caller
      // When an unregistered list route is requested
      const res = await call('GET', '/api/lists', { cookie: cookieA });

      // Then the shared not-found error is returned
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(NOT_FOUND);
    });
  });
});
