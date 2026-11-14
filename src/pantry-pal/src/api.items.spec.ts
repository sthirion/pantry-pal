import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nameKey } from '@pantry-pal/shared';
import { createHousehold, createUser } from './admin-commands.js';
import { ORIGIN, useHarness } from './api.harness.js';
import {
  changeCounter,
  householdMember,
  itemSuggestion,
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
const ITEM_ON_OTHER_LIST =
  '{"error":{"code":"item_on_other_list","message":"Item is on another list."}}';
const INTERNAL =
  '{"error":{"code":"internal_error","message":"An unexpected error occurred."}}';
const NOT_FOUND = '{"error":{"code":"not_found","message":"Not found."}}';
const NAME_LENGTH = 'Must be 1 to 200 characters.';
const CONTENT_TYPE = 'Content-Type must be application/json.';
const INVALID_JSON = 'Body must be valid JSON.';

// Server clock fixed at 2026-11-13T12:00:00.000Z; every timestamp below is relative to it.
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const minutes = (n: number) => NOW + n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const STORED = minutes(-60);
const NEWER_MS = minutes(-30);
const NEWER = iso(NEWER_MS);
const OLDER = iso(minutes(-120));
const FUTURE = iso(minutes(60));

const listId = (n: number) =>
  `0192f0c2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const itemId = (n: number) =>
  `0192f0c3-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const LIST_ID = listId(0x0a);
const LIST_2 = listId(0x0b);
const LIST_B = listId(0x0c);
const LIST_DELETED = listId(0x0d);
const LIST_B_DELETED = listId(0x0e);
const MISSING_LIST = listId(0xff);
const ITEM_1 = itemId(1);
const ITEM_2 = itemId(2);
const ITEM_3 = itemId(3);
const ITEM_4 = itemId(4);
const NEW_ID = itemId(0x20);
const UNKNOWN_ID = itemId(0x30);
const FOREIGN_ID = itemId(0x40);
const OTHER_LIST_ID = itemId(0x50);

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

function itemJson(o: {
  id: string;
  listId?: string;
  name: string;
  crossedOffAt?: number | null;
  version: number;
  updatedAt: number;
  deletedAt?: number | null;
}) {
  return {
    id: o.id,
    listId: o.listId ?? LIST_ID,
    name: o.name,
    crossedOffAt: o.crossedOffAt == null ? null : iso(o.crossedOffAt),
    version: o.version,
    updatedAt: iso(o.updatedAt),
    deletedAt: o.deletedAt == null ? null : iso(o.deletedAt),
  };
}

type ItemRow = typeof listItem.$inferSelect;

function projection(r: ItemRow) {
  return itemJson({
    id: r.id,
    listId: r.listId,
    name: r.name,
    crossedOffAt: r.crossedOffAt,
    version: r.version,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  });
}

const putBody = (o: Record<string, unknown> = {}) => ({
  name: 'Ice cream',
  crossedOff: false,
  changedAt: NEWER,
  ...o,
});

const putBodyWithout = (key: string) =>
  Object.fromEntries(Object.entries(putBody()).filter(([k]) => k !== key));

const batchBody = (o: Record<string, unknown> = {}) => ({
  itemIds: [ITEM_1],
  changedAt: NEWER,
  ...o,
});

const batchBodyWithout = (key: string) =>
  Object.fromEntries(Object.entries(batchBody()).filter(([k]) => k !== key));

type Who = 'a1' | 'a2' | 'b1' | 'n1';

interface Send {
  /** Session user (default `a1`, owner of household one). */
  as?: Who;
  /** Overrides `as`; `null` sends no cookie. */
  cookie?: string | null;
  /** `null` omits the header. */
  origin?: string | null;
  site?: string;
  body?: unknown;
  raw?: string;
  /** `null` sends the body without a Content-Type header. */
  contentType?: string | null;
}

describe('Items API', () => {
  const ctx = useHarness({ eventHub: hub, now: () => NOW });

  let h1: string;
  let h2: string;
  const cookies = new Map<Who, string>();

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

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

  /** Users are created and signed in on first use to keep password hashing off unrelated tests. */
  async function cookieFor(who: Who) {
    const cached = cookies.get(who);
    if (cached) return cached;
    const householdId = who === 'b1' ? h2 : h1;
    const email = `${who}@test.com`;
    const userId = await seedMember(
      email,
      householdId,
      who === 'a1' ? 'owner' : 'member',
    );
    const cookie = await signIn(email, householdId);
    if (who === 'n1') {
      ctx.h.db
        .delete(householdMember)
        .where(eq(householdMember.userId, userId))
        .run();
    }
    cookies.set(who, cookie);
    return cookie;
  }

  async function call(method: string, path: string, o: Send = {}) {
    const headers: Record<string, string> = {};
    const cookie =
      o.cookie === undefined ? await cookieFor(o.as ?? 'a1') : o.cookie;
    if (cookie) headers.Cookie = cookie;
    if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
    if (o.site) headers['Sec-Fetch-Site'] = o.site;
    let body: string | Blob | undefined;
    const text =
      o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    if (text !== undefined) {
      if (o.contentType === null) {
        body = new Blob([text]);
      } else {
        body = text;
        headers['Content-Type'] = o.contentType ?? 'application/json';
      }
    }
    return ctx.get(path, { method, headers, body });
  }

  const itemUrl = (list: string, id: string) =>
    `/api/lists/${list}/items/${id}`;

  const putItem = (list: string, id: string, body: unknown, o: Send = {}) =>
    call('PUT', itemUrl(list, id), { body, ...o });

  function delItem(
    list: string,
    id: string,
    changedAt: string | undefined,
    o: Send = {},
  ) {
    const query =
      changedAt === undefined
        ? ''
        : `?changedAt=${encodeURIComponent(changedAt)}`;
    return call('DELETE', `${itemUrl(list, id)}${query}`, o);
  }

  const batch = (list: string, body: unknown, o: Send = {}) =>
    call('POST', `/api/lists/${list}/items/delete-batch`, { body, ...o });

  beforeEach(() => {
    cookies.clear();
    h1 = createHousehold(ctx.h.db, { name: 'Household One' });
    h2 = createHousehold(ctx.h.db, { name: 'Household Two' });
    seedList({ id: LIST_ID, name: 'Groceries' });
    seedList({ id: LIST_2, name: 'Market' });
    seedList({ id: LIST_B, name: 'Theirs', householdId: h2 });
    seedList({ id: LIST_DELETED, name: 'Old', deletedAt: STORED });
    seedList({
      id: LIST_B_DELETED,
      name: 'Their old',
      householdId: h2,
      deletedAt: STORED,
    });
  });

  const counter = () =>
    ctx.h.db.select().from(changeCounter).where(eq(changeCounter.id, 1)).get()!
      .value;

  const itemRow = (id: string) =>
    ctx.h.db.select().from(listItem).where(eq(listItem.id, id)).get();

  const suggestions = () =>
    ctx.h.db
      .select()
      .from(itemSuggestion)
      .all()
      .sort((a, b) =>
        `${a.householdId}|${a.nameKey}`.localeCompare(
          `${b.householdId}|${b.nameKey}`,
        ),
      );

  const suggestion = (householdId: string, key: string) =>
    suggestions().find(
      (s) => s.householdId === householdId && s.nameKey === key,
    );

  function snapshot() {
    const byId = <T extends { id: string }>(a: T, b: T) =>
      a.id.localeCompare(b.id);
    return {
      lists: ctx.h.db.select().from(shoppingList).all().sort(byId),
      items: ctx.h.db.select().from(listItem).all().sort(byId),
      suggestions: suggestions(),
      counter: counter(),
    };
  }

  function seedList(o: {
    id: string;
    householdId?: string;
    name: string;
    deletedAt?: number | null;
  }) {
    const version = counter() + 1;
    ctx.h.db
      .insert(shoppingList)
      .values({
        id: o.id,
        householdId: o.householdId ?? h1,
        name: o.name,
        nameKey: nameKey(o.name),
        version,
        createdAt: STORED,
        updatedAt: STORED,
        deletedAt: o.deletedAt ?? null,
      })
      .run();
    ctx.h.db
      .update(changeCounter)
      .set({ value: version })
      .where(eq(changeCounter.id, 1))
      .run();
  }

  function seedItem(o: {
    id: string;
    listId?: string;
    householdId?: string;
    name?: string;
    crossedOffAt?: number | null;
    updatedAt?: number;
    deletedAt?: number | null;
  }) {
    const name = o.name ?? `Item ${o.id.slice(-3)}`;
    const version = counter() + 1;
    ctx.h.db
      .insert(listItem)
      .values({
        id: o.id,
        householdId: o.householdId ?? h1,
        listId: o.listId ?? LIST_ID,
        name,
        nameKey: nameKey(name),
        crossedOffAt: o.crossedOffAt ?? null,
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
  }

  function seedSuggestion(
    householdId: string,
    key: string,
    useCount: number,
    name = key,
  ) {
    ctx.h.db
      .insert(itemSuggestion)
      .values({ householdId, nameKey: key, name, useCount, lastUsedAt: STORED })
      .run();
  }

  function failOn(event: 'INSERT' | 'UPDATE', table: string) {
    ctx.h.sqlite.exec(
      `CREATE TRIGGER fail_${event.toLowerCase()}_${table} BEFORE ${event} ON ${table}
       BEGIN SELECT RAISE(ABORT, 'secret-trigger-detail'); END;`,
    );
  }

  interface Route {
    label: string;
    ok: number;
    send: (list: string, o?: Send) => Promise<Response>;
    bad: (o?: Send) => Promise<Response>;
  }

  const routes: Route[] = [
    {
      label: 'PUT item',
      ok: 201,
      send: (list, o) => putItem(list, NEW_ID, putBody(), o),
      bad: (o) => putItem('not-a-uuid', 'bad', {}, o),
    },
    {
      label: 'DELETE item',
      ok: 204,
      send: (list, o) => delItem(list, ITEM_1, NEWER, o),
      bad: (o) => delItem('not-a-uuid', 'bad', undefined, o),
    },
    {
      label: 'delete-batch',
      ok: 204,
      send: (list, o) => batch(list, batchBody(), o),
      bad: (o) => batch('not-a-uuid', {}, o),
    },
  ];

  describe('PUT item create, cross off and restore', () => {
    it('PUT item with a valid body returns 201 with the item contract and publishes the version', async () => {
      // Given a subscriber on household one
      const events = watch(h1);
      const v = counter();

      // When an item is created with an unnormalized name and an offset changedAt
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({
          name: '  Ice   cream ',
          changedAt: '2026-11-13T13:00:00+02:00',
        }),
      );

      // Then the ListItem envelope is returned with millisecond UTC timestamps
      expect(res.status).toBe(201);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json();
      expect(body).toEqual({
        item: itemJson({
          id: NEW_ID,
          name: 'Ice cream',
          version: v + 1,
          updatedAt: STORED,
        }),
        applied: true,
      });
      expect(body).not.toHaveProperty('mergedFromId');
      expect(itemRow(NEW_ID)).toMatchObject({
        householdId: h1,
        listId: LIST_ID,
        nameKey: 'ice cream',
        createdAt: NOW,
        updatedAt: STORED,
        deletedAt: null,
      });
      expect(counter()).toBe(v + 1);
      expect(events).toEqual([v + 1]);
    });

    it('PUT item creating a crossed-off item sets crossedOffAt to the clamped changedAt', async () => {
      // Given no item
      // When an item is created crossed off
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ crossedOff: true, changedAt: NEWER }),
      );

      // Then crossedOffAt equals the changedAt
      expect(res.status).toBe(201);
      expect((await res.json()).item).toMatchObject({
        crossedOffAt: NEWER,
        updatedAt: NEWER,
      });
    });

    it('PUT item with a future changedAt on create stores server time in updatedAt and crossedOffAt', async () => {
      // Given a future client timestamp
      // When a crossed-off item is created
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ crossedOff: true, changedAt: FUTURE }),
      );

      // Then both timestamps are the server clock
      expect(res.status).toBe(201);
      expect((await res.json()).item).toMatchObject({
        crossedOffAt: iso(NOW),
        updatedAt: iso(NOW),
      });
    });

    it('PUT item with a changedAt one millisecond after server time is clamped', async () => {
      // Given a stored item
      seedItem({ id: ITEM_1, name: 'Ice cream' });

      // When a cross-off arrives one millisecond in the future
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ crossedOff: true, changedAt: iso(NOW + 1) }),
      );

      // Then it applies at server time
      expect((await res.json()).item).toMatchObject({
        updatedAt: iso(NOW),
        crossedOffAt: iso(NOW),
      });
    });

    it('PUT item crossing off an active item returns 200 applied true with crossedOffAt', async () => {
      // Given an active item and a subscriber
      seedItem({ id: ITEM_1, name: 'Ice cream' });
      const events = watch(h1);
      const v = counter();

      // When it is crossed off with a newer changedAt
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ crossedOff: true, changedAt: NEWER }),
      );

      // Then the item is updated under the next version
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        item: itemJson({
          id: ITEM_1,
          name: 'Ice cream',
          crossedOffAt: NEWER_MS,
          version: v + 1,
          updatedAt: NEWER_MS,
        }),
        applied: true,
      });
      expect(events).toEqual([v + 1]);
    });

    it('PUT item restoring a crossed-off item clears crossedOffAt', async () => {
      // Given a crossed-off item
      seedItem({ id: ITEM_1, name: 'Ice cream', crossedOffAt: STORED });
      const v = counter();

      // When it is restored with a newer changedAt
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ crossedOff: false, changedAt: NEWER }),
      );

      // Then crossedOffAt is null
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        item: itemJson({
          id: ITEM_1,
          name: 'Ice cream',
          crossedOffAt: null,
          version: v + 1,
          updatedAt: NEWER_MS,
        }),
        applied: true,
      });
    });

    it('PUT item renaming a crossed-off item keeps crossedOffAt', async () => {
      // Given a crossed-off item
      seedItem({ id: ITEM_1, name: 'Ice cream', crossedOffAt: STORED });

      // When it is renamed and stays crossed off
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'Gelato', crossedOff: true, changedAt: NEWER }),
      );

      // Then crossedOffAt is unchanged and updatedAt advances
      expect(res.status).toBe(200);
      expect((await res.json()).item).toMatchObject({
        name: 'Gelato',
        crossedOffAt: iso(STORED),
        updatedAt: NEWER,
      });
    });

    it('PUT item with a future changedAt on an existing item stores server time', async () => {
      // Given an active item
      seedItem({ id: ITEM_1, name: 'Ice cream' });

      // When it is crossed off with a future changedAt
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ crossedOff: true, changedAt: FUTURE }),
      );

      // Then both timestamps are the server clock
      expect((await res.json()).item).toMatchObject({
        crossedOffAt: iso(NOW),
        updatedAt: iso(NOW),
      });
    });

    it('PUT item with a changedAt equal to the stored instant in another offset applies', async () => {
      // Given an item stored at 11:00Z
      seedItem({ id: ITEM_1, name: 'Ice cream' });
      const events = watch(h1);

      // When a cross-off arrives at 13:00+02:00, the same instant
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ crossedOff: true, changedAt: '2026-11-13T13:00:00+02:00' }),
      );

      // Then equality applies
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.item.updatedAt).toBe(iso(STORED));
      expect(events).toHaveLength(1);
    });

    it('PUT item with an older changedAt returns 200 applied false with the stored item', async () => {
      // Given a stored item and a subscriber
      seedItem({ id: ITEM_1, name: 'Ice cream' });
      const events = watch(h1);
      const before = snapshot();
      const stored = projection(itemRow(ITEM_1)!);

      // When an older rename arrives
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'Stale', changedAt: OLDER }),
      );

      // Then the stored item is returned and nothing changes
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ item: stored, applied: false });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('PUT item with an older instant in another offset is stale', async () => {
      // Given an item stored at 11:00Z
      seedItem({ id: ITEM_1, name: 'Ice cream' });
      const before = snapshot();

      // When a cross-off carries 12:59+02:00, which is 10:59Z
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ crossedOff: true, changedAt: '2026-11-13T12:59:00+02:00' }),
      );

      // Then it is not applied
      expect((await res.json()).applied).toBe(false);
      expect(snapshot()).toEqual(before);
    });

    it.each([
      ['an active item sent active', null, false],
      ['a crossed-off item sent crossed off', STORED, true],
    ])(
      'PUT item with %s is a no-op for any changedAt',
      async (_label, crossedOffAt, crossedOff) => {
        // Given a live item and a subscriber
        seedItem({ id: ITEM_1, name: 'Ice cream', crossedOffAt });
        const events = watch(h1);
        const before = snapshot();
        const stored = projection(itemRow(ITEM_1)!);

        for (const changedAt of [iso(STORED), NEWER, FUTURE]) {
          // When the identical state is sent with a changedAt not older than the stored one
          const res = await putItem(
            LIST_ID,
            ITEM_1,
            putBody({ name: ' Ice  cream ', crossedOff, changedAt }),
          );

          // Then it is applied false with the stored item
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({ item: stored, applied: false });
        }
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('PUT item stores SQL-looking names verbatim', async () => {
      // Given a name containing SQL
      const name = "x'); DROP TABLE list_item;--";

      // When the item is created
      const res = await putItem(LIST_ID, NEW_ID, putBody({ name }));

      // Then it is stored as data and the table still works
      expect(res.status).toBe(201);
      expect(itemRow(NEW_ID)?.name).toBe(name);
    });
  });

  describe('PUT item validation', () => {
    type Row = [
      string,
      string,
      string,
      Send,
      Array<{ path: string; message?: string }>,
    ];
    const ok = () => putBody();
    const rows: Row[] = [
      ...['abc', '123', LIST_ID.slice(0, -1)].map(
        (id): Row => [
          `listId ${id}`,
          id,
          NEW_ID,
          { body: ok() },
          [{ path: 'listId' }],
        ],
      ),
      ...['not-a-uuid', '123'].map(
        (id): Row => [
          `itemId ${id}`,
          LIST_ID,
          id,
          { body: ok() },
          [{ path: 'itemId' }],
        ],
      ),
      ...(
        [
          ['Content-Type text/plain', { contentType: 'text/plain' }],
          [
            'Content-Type form-urlencoded',
            { contentType: 'application/x-www-form-urlencoded' },
          ],
          ['no Content-Type', { contentType: null }],
        ] as Array<[string, Send]>
      ).map(
        ([label, extra]): Row => [
          label,
          LIST_ID,
          NEW_ID,
          { body: ok(), ...extra },
          [{ path: '', message: CONTENT_TYPE }],
        ],
      ),
      ...['{', ''].map(
        (raw): Row => [
          `raw body ${JSON.stringify(raw)}`,
          LIST_ID,
          NEW_ID,
          { raw },
          [{ path: '', message: INVALID_JSON }],
        ],
      ),
      ...['null', '[]', '"x"'].map(
        (raw): Row => [
          `JSON body ${raw}`,
          LIST_ID,
          NEW_ID,
          { raw },
          [{ path: '' }],
        ],
      ),
      [
        'no name',
        LIST_ID,
        NEW_ID,
        { body: putBodyWithout('name') },
        [{ path: 'name' }],
      ],
      [
        'name 42',
        LIST_ID,
        NEW_ID,
        { body: putBody({ name: 42 }) },
        [{ path: 'name' }],
      ],
      [
        'empty name',
        LIST_ID,
        NEW_ID,
        { body: putBody({ name: '' }) },
        [{ path: 'name', message: NAME_LENGTH }],
      ],
      [
        'whitespace-only name',
        LIST_ID,
        NEW_ID,
        { body: putBody({ name: '   ' }) },
        [{ path: 'name', message: NAME_LENGTH }],
      ],
      [
        '201-character name',
        LIST_ID,
        NEW_ID,
        { body: putBody({ name: 'a'.repeat(201) }) },
        [{ path: 'name', message: NAME_LENGTH }],
      ],
      [
        'name of 201 characters after trim and collapse',
        LIST_ID,
        NEW_ID,
        {
          body: putBody({ name: ` ${'a'.repeat(100)}   ${'b'.repeat(100)} ` }),
        },
        [{ path: 'name', message: NAME_LENGTH }],
      ],
      ...(['"true"', '1', 'null'] as const).map(
        (value): Row => [
          `crossedOff ${value}`,
          LIST_ID,
          NEW_ID,
          {
            raw: `{"name":"Ice cream","crossedOff":${value},"changedAt":"${NEWER}"}`,
          },
          [{ path: 'crossedOff' }],
        ],
      ),
      [
        'no crossedOff',
        LIST_ID,
        NEW_ID,
        { body: putBodyWithout('crossedOff') },
        [{ path: 'crossedOff' }],
      ],
      [
        'no changedAt',
        LIST_ID,
        NEW_ID,
        { body: putBodyWithout('changedAt') },
        [{ path: 'changedAt' }],
      ],
      ...(
        [
          '',
          '2026-11-13',
          '2026-11-13T10:00:00',
          'not-a-date',
          1731492000000,
          null,
        ] as unknown[]
      ).map(
        (value): Row => [
          `changedAt ${JSON.stringify(value)}`,
          LIST_ID,
          NEW_ID,
          { body: putBody({ changedAt: value }) },
          [{ path: 'changedAt' }],
        ],
      ),
    ];

    it.each(rows)(
      'PUT item with %s returns 400 and writes nothing',
      async (_label, list, id, send, details) => {
        // Given an invalid input and a subscriber
        const events = watch(h1);
        const before = snapshot();

        // When the item is put
        const res = await putItem(list, id, send.body, send);

        // Then the exact failing paths are reported and nothing is written
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(validation(...details));
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('PUT item with every input invalid reports every failing path', async () => {
      // Given an invalid itemId and an empty JSON object
      // When the item is put
      const res = await putItem(LIST_ID, 'not-a-uuid', {});

      // Then all four paths are reported in one 400
      expect(res.status).toBe(400);
      const paths = (await res.json()).error.details.map(
        (d: { path: string }) => d.path,
      );
      expect([...paths].sort()).toEqual(
        ['changedAt', 'crossedOff', 'itemId', 'name'].sort(),
      );
    });

    it('PUT item with a wrong content type and an invalid itemId reports both paths', async () => {
      // Given text/plain and a bad itemId
      // When the item is put
      const res = await putItem(LIST_ID, 'not-a-uuid', putBody(), {
        contentType: 'text/plain',
      });

      // Then the root and itemId paths are reported
      expect(res.status).toBe(400);
      const paths = (await res.json()).error.details.map(
        (d: { path: string }) => d.path,
      );
      expect([...paths].sort()).toEqual(['', 'itemId']);
    });

    it('PUT item with validation errors does not leak internals', async () => {
      // Given an invalid request
      // When it is sent
      const res = await putItem('not-a-uuid', 'bad', undefined, {
        raw: '{not json',
      });

      // Then the body carries no stack, SQL or file paths
      expect(await res.text()).not.toMatch(
        /stack|sqlite|select |insert |\.ts|node_modules/i,
      );
    });

    it.each([
      ['a 1-character name', { body: putBody({ name: 'a' }) }],
      ['a 200-character name', { body: putBody({ name: 'a'.repeat(200) }) }],
      [
        'a name of 200 characters after trim and collapse',
        {
          body: putBody({
            name: `  ${'a'.repeat(100)}     ${'b'.repeat(99)}  `,
          }),
        },
      ],
      [
        'Content-Type with a charset parameter',
        { contentType: 'application/json; charset=utf-8' },
      ],
      [
        'an extra householdId body field',
        {
          body: putBody({
            householdId: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
          }),
        },
      ],
    ] as Array<[string, Send]>)(
      'PUT item with %s returns 201',
      async (_label, extra) => {
        // Given a valid boundary input
        // When the item is created
        const res = await putItem(LIST_ID, NEW_ID, putBody(), extra);

        // Then it is accepted and stored under the session household
        expect(res.status).toBe(201);
        expect(itemRow(NEW_ID)?.householdId).toBe(h1);
      },
    );

    it('PUT item ignores a householdId query parameter', async () => {
      // Given household two's id in the query
      // When an item is created
      const res = await call(
        'PUT',
        `${itemUrl(LIST_ID, NEW_ID)}?householdId=${h2}`,
        { body: putBody() },
      );

      // Then the session household is used
      expect(res.status).toBe(201);
      expect(itemRow(NEW_ID)?.householdId).toBe(h1);
    });
  });

  describe('PUT item same-name merge', () => {
    it('PUT item with a new id and a same-name live item merges, keeps the stored name and restores it', async () => {
      // Given a crossed-off item "milk" and a subscriber
      seedItem({ id: ITEM_1, name: 'milk', crossedOffAt: STORED });
      const events = watch(h1);
      const v = counter();

      // When another id is created as " Milk " active with a newer changedAt
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: ' Milk ', crossedOff: false }),
      );

      // Then the existing item is updated in place and mergedFromId is returned
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        item: itemJson({
          id: ITEM_1,
          name: 'milk',
          crossedOffAt: null,
          version: v + 1,
          updatedAt: NEWER_MS,
        }),
        applied: true,
        mergedFromId: NEW_ID,
      });
      expect(itemRow(NEW_ID)).toBeUndefined();
      expect(counter()).toBe(v + 1);
      expect(events).toEqual([v + 1]);
      expect(suggestions()).toEqual([]);
    });

    it('PUT item merging crossed off sets crossedOffAt to the clamped changedAt', async () => {
      // Given an active item "milk"
      seedItem({ id: ITEM_1, name: 'milk' });

      // When a same-name create arrives crossed off with a future changedAt
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: 'milk', crossedOff: true, changedAt: FUTURE }),
      );

      // Then the target is crossed off at server time
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.item).toMatchObject({
        id: ITEM_1,
        crossedOffAt: iso(NOW),
        updatedAt: iso(NOW),
      });
    });

    it('PUT item merging with a changedAt equal to the stored instant applies', async () => {
      // Given an active item "milk" stored at T
      seedItem({ id: ITEM_1, name: 'milk' });

      // When a same-name create crosses it off at T
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: 'milk', crossedOff: true, changedAt: iso(STORED) }),
      );

      // Then equality applies
      expect((await res.json()).applied).toBe(true);
    });

    it('PUT item merging with an older changedAt returns the target unchanged with applied false', async () => {
      // Given a live item "milk" and a subscriber
      seedItem({ id: ITEM_1, name: 'milk' });
      const events = watch(h1);
      const before = snapshot();
      const stored = projection(itemRow(ITEM_1)!);

      // When a stale same-name create arrives
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: 'milk', crossedOff: true, changedAt: OLDER }),
      );

      // Then nothing changes
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        item: stored,
        applied: false,
        mergedFromId: NEW_ID,
      });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it.each([
      ['an active target sent active', null, false],
      ['a crossed-off target sent crossed off', STORED, true],
    ])(
      'PUT item merging into %s is a no-op',
      async (_label, crossedOffAt, crossedOff) => {
        // Given a live item "milk" already in the requested state
        seedItem({ id: ITEM_1, name: 'milk', crossedOffAt });
        const events = watch(h1);
        const before = snapshot();
        const stored = projection(itemRow(ITEM_1)!);

        // When a same-name create with a newer changedAt arrives
        const res = await putItem(
          LIST_ID,
          NEW_ID,
          putBody({ name: 'MILK', crossedOff, changedAt: NEWER }),
        );

        // Then applied false, no version, event or suggestion
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          item: stored,
          applied: false,
          mergedFromId: NEW_ID,
        });
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it.each([
      [
        'a live same-name item on another list of the household',
        () => seedItem({ id: ITEM_1, listId: LIST_2, name: 'milk' }),
      ],
      [
        'a soft-deleted same-name item on the list',
        () => seedItem({ id: ITEM_1, name: 'milk', deletedAt: STORED }),
      ],
      [
        'a live same-name item of another household',
        () =>
          seedItem({
            id: ITEM_1,
            listId: LIST_B,
            householdId: h2,
            name: 'milk',
          }),
      ],
    ])('PUT item with %s creates a new item', async (_label, seed) => {
      // Given the same name outside the live list scope
      seed();
      const other = itemRow(ITEM_1);

      // When a new id is created as milk
      const res = await putItem(LIST_ID, NEW_ID, putBody({ name: 'milk' }));

      // Then a new item exists and the other row is untouched
      expect(res.status).toBe(201);
      expect(await res.json()).not.toHaveProperty('mergedFromId');
      expect(itemRow(NEW_ID)).toBeDefined();
      expect(itemRow(ITEM_1)).toEqual(other);
    });

    it.each([
      ['Café', 'Cafe\u0301'],
      ['äpfel', 'ÄPFEL'],
    ])(
      'PUT item merges %j with %j by name key and keeps the stored name',
      async (stored, requested) => {
        // Given a live item with the stored name
        seedItem({ id: ITEM_1, name: stored });

        // When another id is created with a canonically equivalent or differently cased name
        const res = await putItem(
          LIST_ID,
          NEW_ID,
          putBody({ name: requested, crossedOff: true }),
        );

        // Then it merges and the stored name is kept
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mergedFromId).toBe(NEW_ID);
        expect(body.item.name).toBe(stored);
        expect(itemRow(NEW_ID)).toBeUndefined();
      },
    );
  });

  describe('PUT item rename conflict', () => {
    beforeEach(() => {
      seedItem({ id: ITEM_1, name: 'milk' });
      seedItem({ id: ITEM_2, name: 'bread' });
    });

    it.each(['MILK', ' milk ', 'Milk'])(
      'PUT item renaming to %j used by another live item returns 409 and changes nothing',
      async (name) => {
        // Given two live items and a subscriber
        const events = watch(h1);
        const before = snapshot();

        // When bread is renamed to the other's name
        const res = await putItem(LIST_ID, ITEM_2, putBody({ name }));

        // Then name_taken is returned and nothing changes
        expect(res.status).toBe(409);
        expect(await res.text()).toBe(NAME_TAKEN);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('PUT item renaming to a canonically equivalent name returns 409', async () => {
      // Given a live item with a precomposed name
      seedItem({ id: ITEM_3, name: 'Café' });

      // When bread is renamed to the decomposed form
      const res = await putItem(
        LIST_ID,
        ITEM_2,
        putBody({ name: 'Cafe\u0301' }),
      );

      // Then the keys collide
      expect(res.status).toBe(409);
      expect(await res.text()).toBe(NAME_TAKEN);
    });

    it('PUT item renaming to the name of a live crossed-off item returns 409', async () => {
      // Given a crossed-off live item
      seedItem({ id: ITEM_3, name: 'eggs', crossedOffAt: STORED });

      // When bread is renamed to eggs
      const res = await putItem(LIST_ID, ITEM_2, putBody({ name: 'Eggs' }));

      // Then crossed-off items still conflict
      expect(res.status).toBe(409);
      expect(await res.text()).toBe(NAME_TAKEN);
    });

    it.each(['Bread', 'Bread x'])(
      'PUT item renaming bread to %j is applied and updates the stored name',
      async (name) => {
        // Given a live item "bread"
        const events = watch(h1);
        const v = counter();

        // When it is renamed with a newer changedAt
        const res = await putItem(LIST_ID, ITEM_2, putBody({ name }));

        // Then it is applied under a new version
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.applied).toBe(true);
        expect(body.item).toMatchObject({ name, version: v + 1 });
        expect(itemRow(ITEM_2)?.nameKey).toBe(nameKey(name));
        expect(events).toEqual([v + 1]);
      },
    );

    it('PUT item with only whitespace differences is a state-identical no-op', async () => {
      // Given bread stored as "bread"
      const before = snapshot();

      // When it is sent as " bread  " (normalizes to the stored name)
      const res = await putItem(LIST_ID, ITEM_2, putBody({ name: ' bread  ' }));

      // Then D3 applies: applied false and nothing changes
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(false);
      expect(snapshot()).toEqual(before);
    });

    it('PUT item renaming to the name of a soft-deleted item on the list is applied', async () => {
      // Given a soft-deleted "butter" on the list
      seedItem({ id: ITEM_3, name: 'butter', deletedAt: STORED });

      // When bread is renamed to butter
      const res = await putItem(LIST_ID, ITEM_2, putBody({ name: 'butter' }));

      // Then it is applied
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
    });

    it('PUT item renaming to the name of a live item on another list is applied', async () => {
      // Given a live "butter" on another list
      seedItem({ id: ITEM_3, listId: LIST_2, name: 'butter' });

      // When bread is renamed to butter
      const res = await putItem(LIST_ID, ITEM_2, putBody({ name: 'butter' }));

      // Then names are scoped per list
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
    });

    it('PUT item renaming with a stale changedAt to a taken name returns 200 applied false, not 409', async () => {
      // Given two live items
      const events = watch(h1);
      const before = snapshot();

      // When a stale rename to the taken name arrives
      const res = await putItem(
        LIST_ID,
        ITEM_2,
        putBody({ name: 'milk', changedAt: OLDER }),
      );

      // Then staleness wins over the conflict
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('PUT item renaming with a changedAt equal to updatedAt is applied', async () => {
      // Given bread stored at T
      // When it is renamed at T
      const res = await putItem(
        LIST_ID,
        ITEM_2,
        putBody({ name: 'rye bread', changedAt: iso(STORED) }),
      );

      // Then equality applies
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.item.updatedAt).toBe(iso(STORED));
    });

    it('PUT item renaming to exactly 200 characters is applied', async () => {
      // Given a live item
      // When it is renamed to 200 characters
      const res = await putItem(
        LIST_ID,
        ITEM_2,
        putBody({ name: 'a'.repeat(200) }),
      );

      // Then it is applied
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
    });

    it('PUT item renaming to 201 characters returns 400 and changes nothing', async () => {
      // Given a live item
      const before = snapshot();

      // When it is renamed to 201 characters
      const res = await putItem(
        LIST_ID,
        ITEM_2,
        putBody({ name: 'a'.repeat(201), changedAt: iso(minutes(-10)) }),
      );

      // Then it is rejected on name
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        validation({ path: 'name', message: NAME_LENGTH }),
      );
      expect(snapshot()).toEqual(before);
    });
  });

  describe('PUT item undelete', () => {
    const tombstone = () =>
      seedItem({
        id: ITEM_1,
        name: 'milk',
        updatedAt: STORED,
        deletedAt: STORED,
      });

    it('PUT item on a soft-deleted item with a newer changedAt undeletes it', async () => {
      // Given a soft-deleted item and a subscriber
      tombstone();
      const events = watch(h1);
      const v = counter();

      // When it is put with a newer changedAt
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: NEWER }),
      );

      // Then it is live again under a new version
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        item: itemJson({
          id: ITEM_1,
          name: 'milk',
          version: v + 1,
          updatedAt: NEWER_MS,
        }),
        applied: true,
      });
      expect(itemRow(ITEM_1)?.deletedAt).toBeNull();
      expect(events).toEqual([v + 1]);
    });

    it('PUT item on a soft-deleted item with an equal changedAt undeletes it', async () => {
      // Given a soft-deleted item
      tombstone();

      // When it is put at the stored instant
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: iso(STORED) }),
      );

      // Then equality applies
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.item.deletedAt).toBeNull();
    });

    it('PUT item on a soft-deleted item with an older changedAt returns the tombstone', async () => {
      // Given a soft-deleted item and a subscriber
      tombstone();
      const events = watch(h1);
      const before = snapshot();
      const stored = projection(itemRow(ITEM_1)!);

      // When an older put arrives
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: OLDER }),
      );

      // Then the tombstone is returned with applied false
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ item: stored, applied: false });
      expect(stored.deletedAt).toBe(iso(STORED));
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it.each([
      [
        'a non-crossed-off tombstone undeleted crossed off',
        null,
        true,
        NEWER_MS,
      ],
      [
        'a crossed-off tombstone undeleted crossed off',
        minutes(-90),
        true,
        minutes(-90),
      ],
      ['a crossed-off tombstone undeleted active', minutes(-90), false, null],
    ])(
      'PUT item on %s sets crossedOffAt',
      async (_label, before, crossedOff, after) => {
        // Given a tombstone with the given crossedOffAt
        seedItem({
          id: ITEM_1,
          name: 'milk',
          crossedOffAt: before,
          deletedAt: STORED,
        });

        // When it is undeleted
        const res = await putItem(
          LIST_ID,
          ITEM_1,
          putBody({ name: 'milk', crossedOff, changedAt: NEWER }),
        );

        // Then crossedOffAt follows D9
        expect(res.status).toBe(200);
        expect((await res.json()).item.crossedOffAt).toBe(
          after === null ? null : iso(after),
        );
      },
    );

    it('PUT item undeleting with a different name renames it and records the suggestion', async () => {
      // Given a soft-deleted "milk"
      tombstone();

      // When it is undeleted as "Oat milk"
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'Oat milk', changedAt: NEWER }),
      );

      // Then the new name is stored and its suggestion is inserted
      expect(res.status).toBe(200);
      expect((await res.json()).item.name).toBe('Oat milk');
      expect(suggestion(h1, 'oat milk')).toMatchObject({
        name: 'Oat milk',
        useCount: 1,
        lastUsedAt: NOW,
      });
    });

    it('PUT item undeleting with the same name does not touch suggestions', async () => {
      // Given a soft-deleted "milk" and an existing suggestion
      tombstone();
      seedSuggestion(h1, 'milk', 2);
      const before = suggestions();

      // When it is undeleted with the same name
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: NEWER }),
      );

      // Then suggestions are unchanged
      expect(res.status).toBe(200);
      expect(suggestions()).toEqual(before);
    });

    it('PUT item undeleting to the name of another soft-deleted item is applied', async () => {
      // Given two soft-deleted items
      tombstone();
      seedItem({ id: ITEM_2, name: 'bread', deletedAt: STORED });
      const other = itemRow(ITEM_2);

      // When the first is undeleted as "bread"
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'bread', changedAt: NEWER }),
      );

      // Then it applies and the other stays deleted
      expect(res.status).toBe(200);
      expect((await res.json()).applied).toBe(true);
      expect(itemRow(ITEM_2)).toEqual(other);
    });

    it('PUT item undeleting to the name of a live item returns 409 and keeps the tombstone', async () => {
      // Given a tombstone "milk" and a live "milk"
      tombstone();
      seedItem({ id: ITEM_2, name: 'milk' });
      const events = watch(h1);
      const before = snapshot();

      // When the tombstone is undeleted
      const res = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: NEWER }),
      );

      // Then name_taken and nothing changes
      expect(res.status).toBe(409);
      expect(await res.text()).toBe(NAME_TAKEN);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(STORED);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('DELETE item', () => {
    it('DELETE item with a newer changedAt soft-deletes it, returns 204 and publishes', async () => {
      // Given a crossed-off item and a subscriber
      seedItem({ id: ITEM_1, crossedOffAt: STORED });
      const events = watch(h1);
      const v = counter();

      // When it is deleted
      const res = await delItem(LIST_ID, ITEM_1, NEWER);

      // Then 204 with no body, deletedAt and updatedAt set, crossedOffAt kept
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(itemRow(ITEM_1)).toMatchObject({
        deletedAt: NEWER_MS,
        updatedAt: NEWER_MS,
        crossedOffAt: STORED,
        version: v + 1,
      });
      expect(counter()).toBe(v + 1);
      expect(events).toEqual([v + 1]);
    });

    it('DELETE item with an offset changedAt is compared as an instant', async () => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When it is deleted at 13:30+02:00 (11:30Z)
      const res = await delItem(LIST_ID, ITEM_1, '2026-11-13T13:30:00+02:00');

      // Then deletedAt is 11:30Z
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it('DELETE item with a changedAt equal to updatedAt deletes it', async () => {
      // Given a live item stored at T
      seedItem({ id: ITEM_1 });

      // When it is deleted at T
      const res = await delItem(LIST_ID, ITEM_1, iso(STORED));

      // Then equality applies
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(STORED);
    });

    it('DELETE item with a future changedAt stores server time', async () => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When it is deleted with a future changedAt
      const res = await delItem(LIST_ID, ITEM_1, FUTURE);

      // Then server time is stored
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)).toMatchObject({ deletedAt: NOW, updatedAt: NOW });
    });

    it('DELETE item with an older changedAt returns 200 applied false and changes nothing', async () => {
      // Given a live item and a subscriber
      seedItem({ id: ITEM_1 });
      const events = watch(h1);
      const before = snapshot();
      const stored = projection(itemRow(ITEM_1)!);

      // When a stale delete arrives
      const res = await delItem(LIST_ID, ITEM_1, OLDER);

      // Then the stored item is returned
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ item: stored, applied: false });
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it('DELETE item with an unknown id returns 204 and creates nothing', async () => {
      // Given no item with that id
      const events = watch(h1);
      const before = snapshot();

      // When it is deleted
      const res = await delItem(LIST_ID, UNKNOWN_ID, NEWER);

      // Then 204 and nothing changes
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });

    it.each([NEWER, OLDER])(
      'DELETE item on an already soft-deleted item with changedAt %s returns 204 and changes nothing',
      async (changedAt) => {
        // Given a soft-deleted item
        seedItem({ id: ITEM_1, deletedAt: STORED });
        const events = watch(h1);
        const before = snapshot();

        // When it is deleted again
        const res = await delItem(LIST_ID, ITEM_1, changedAt);

        // Then 204 and unchanged
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('DELETE item ignores Content-Type and body', async () => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When it is deleted with text/plain and a broken body
      const res = await call(
        'DELETE',
        `${itemUrl(LIST_ID, ITEM_1)}?changedAt=${encodeURIComponent(NEWER)}`,
        { raw: '{', contentType: 'text/plain' },
      );

      // Then it is answered from params and query alone
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it('DELETE item ignores a householdId query parameter', async () => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When it is deleted with household two's id in the query
      const res = await call(
        'DELETE',
        `${itemUrl(LIST_ID, ITEM_1)}?householdId=${h2}&changedAt=${encodeURIComponent(NEWER)}`,
      );

      // Then the session household applies
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it.each([
      ['listId abc', 'abc', ITEM_1, NEWER, ['listId']],
      ['listId 123', '123', ITEM_1, NEWER, ['listId']],
      [
        'a 35-character listId',
        LIST_ID.slice(0, -1),
        ITEM_1,
        NEWER,
        ['listId'],
      ],
      ['itemId not-a-uuid', LIST_ID, 'not-a-uuid', NEWER, ['itemId']],
      ['itemId 123', LIST_ID, '123', NEWER, ['itemId']],
      ['no changedAt', LIST_ID, ITEM_1, undefined, ['changedAt']],
      ['an empty changedAt', LIST_ID, ITEM_1, '', ['changedAt']],
      ['a date-only changedAt', LIST_ID, ITEM_1, '2026-11-13', ['changedAt']],
      [
        'a changedAt without offset',
        LIST_ID,
        ITEM_1,
        '2026-11-13T10:00:00',
        ['changedAt'],
      ],
      ['a free-text changedAt', LIST_ID, ITEM_1, 'not-a-date', ['changedAt']],
      ['a numeric changedAt', LIST_ID, ITEM_1, '1731492000000', ['changedAt']],
      [
        'every input invalid',
        'abc',
        'bad',
        undefined,
        ['changedAt', 'itemId', 'listId'],
      ],
    ] as Array<[string, string, string, string | undefined, string[]]>)(
      'DELETE item with %s returns 400 and deletes nothing',
      async (_label, list, id, changedAt, paths) => {
        // Given a live item and a subscriber
        seedItem({ id: ITEM_1 });
        const events = watch(h1);
        const before = snapshot();

        // When the delete is sent
        const res = await delItem(list, id, changedAt);

        // Then each failing path is reported
        expect(res.status).toBe(400);
        const details = (await res.json()).error.details as Array<{
          path: string;
        }>;
        expect(details.map((d) => d.path).sort()).toEqual([...paths].sort());
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );
  });

  describe('DELETE batch', () => {
    const OLD = minutes(-90);

    it('POST delete-batch deletes only eligible items, shares one version and publishes once', async () => {
      // Given eligible X1 (crossed off) and X2, a newer X3, a deleted X4 and an unknown id
      seedItem({ id: ITEM_1, crossedOffAt: OLD, updatedAt: OLD });
      seedItem({ id: ITEM_2, updatedAt: OLD });
      seedItem({ id: ITEM_3, updatedAt: minutes(-10) });
      seedItem({ id: ITEM_4, updatedAt: OLD, deletedAt: OLD });
      const untouched = [itemRow(ITEM_3), itemRow(ITEM_4)];
      const events = watch(h1);
      const events2 = watch(h2);
      const v = counter();

      // When the batch lists duplicates, unknown and ineligible ids
      const res = await batch(LIST_ID, {
        itemIds: [ITEM_1, ITEM_2, ITEM_3, ITEM_4, UNKNOWN_ID, ITEM_1],
        changedAt: NEWER,
      });

      // Then 204 with an empty body and one shared version for the eligible items
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(itemRow(ITEM_1)).toMatchObject({
        deletedAt: NEWER_MS,
        updatedAt: NEWER_MS,
        crossedOffAt: OLD,
        version: v + 1,
      });
      expect(itemRow(ITEM_2)).toMatchObject({
        deletedAt: NEWER_MS,
        updatedAt: NEWER_MS,
        version: v + 1,
      });
      expect([itemRow(ITEM_3), itemRow(ITEM_4)]).toEqual(untouched);
      expect(itemRow(UNKNOWN_ID)).toBeUndefined();
      expect(counter()).toBe(v + 1);
      expect(events).toEqual([v + 1]);
      expect(events2).toEqual([]);
    });

    it('POST delete-batch deletes an item whose updatedAt equals the batch changedAt', async () => {
      // Given an item updated exactly at the batch time
      seedItem({ id: ITEM_1, updatedAt: NEWER_MS });

      // When the batch is sent at that instant
      const res = await batch(LIST_ID, batchBody());

      // Then equality is eligible
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it('POST delete-batch with a future changedAt stores server time', async () => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When the batch carries a future changedAt
      const res = await batch(LIST_ID, batchBody({ changedAt: FUTURE }));

      // Then server time is stored
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)).toMatchObject({ deletedAt: NOW, updatedAt: NOW });
    });

    it('POST delete-batch with an offset changedAt is compared as an instant', async () => {
      // Given an item updated at 11:30Z
      seedItem({ id: ITEM_1, updatedAt: NEWER_MS });

      // When the batch is 13:30+02:00
      const res = await batch(
        LIST_ID,
        batchBody({ changedAt: '2026-11-13T13:30:00+02:00' }),
      );

      // Then the item is deleted
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it.each([
      ['only unknown ids', () => undefined, [UNKNOWN_ID, OTHER_LIST_ID]],
      [
        'only already soft-deleted items',
        () => seedItem({ id: ITEM_1, updatedAt: STORED, deletedAt: STORED }),
        [ITEM_1],
      ],
      [
        'only items changed after the batch',
        () => seedItem({ id: ITEM_1, updatedAt: minutes(-10) }),
        [ITEM_1],
      ],
      [
        'a mix of unknown, deleted and newer items',
        () => {
          seedItem({ id: ITEM_1, updatedAt: STORED, deletedAt: STORED });
          seedItem({ id: ITEM_2, updatedAt: minutes(-10) });
        },
        [ITEM_1, ITEM_2, UNKNOWN_ID],
      ],
    ] as Array<[string, () => void, string[]]>)(
      'POST delete-batch with %s returns 204 without a version or event',
      async (_label, seed, ids) => {
        // Given nothing eligible and a subscriber
        seed();
        const events = watch(h1);
        const before = snapshot();

        // When the batch is sent
        const res = await batch(LIST_ID, { itemIds: ids, changedAt: NEWER });

        // Then 204 and nothing changes
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('POST delete-batch with 500 ids returns 204', async () => {
      // Given 500 valid ids with one live item among them
      seedItem({ id: ITEM_1 });
      const ids = [
        ITEM_1,
        ...Array.from({ length: 499 }, (_, i) => itemId(0x1000 + i)),
      ];

      // When the batch is sent
      const res = await batch(LIST_ID, { itemIds: ids, changedAt: NEWER });

      // Then it is accepted
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it('POST delete-batch with a foreign id returns 403 and deletes nothing', async () => {
      // Given an eligible item and an item of household two
      seedItem({ id: ITEM_1 });
      seedItem({
        id: FOREIGN_ID,
        listId: LIST_B,
        householdId: h2,
      });
      const events = watch(h1);
      const events2 = watch(h2);
      const before = snapshot();

      // When both are listed
      const res = await batch(
        LIST_ID,
        batchBody({ itemIds: [ITEM_1, FOREIGN_ID] }),
      );

      // Then forbidden and atomic
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
      expect(events2).toEqual([]);
    });

    it.each([
      ['a live item of another list', LIST_2, null],
      ['a soft-deleted item of another list', LIST_2, STORED],
      ['an item of a soft-deleted list', LIST_DELETED, null],
    ] as Array<[string, string, number | null]>)(
      'POST delete-batch with %s returns 409 item_on_other_list and deletes nothing',
      async (_label, otherList, deletedAt) => {
        // Given an eligible item on the list and another item elsewhere in the household
        seedItem({ id: ITEM_1 });
        seedItem({ id: OTHER_LIST_ID, listId: otherList, deletedAt });
        const events = watch(h1);
        const before = snapshot();

        // When both are listed
        const res = await batch(
          LIST_ID,
          batchBody({ itemIds: [ITEM_1, OTHER_LIST_ID] }),
        );

        // Then 409 with the exact body, nothing deleted, no version or event
        expect(res.status).toBe(409);
        expect(await res.text()).toBe(ITEM_ON_OTHER_LIST);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('POST delete-batch with both a foreign and a cross-list id returns 403', async () => {
      // Given a cross-list item and a foreign item
      seedItem({ id: OTHER_LIST_ID, listId: LIST_2 });
      seedItem({ id: FOREIGN_ID, listId: LIST_B, householdId: h2 });
      const before = snapshot();

      // When both are listed
      const res = await batch(
        LIST_ID,
        batchBody({ itemIds: [OTHER_LIST_ID, FOREIGN_ID] }),
      );

      // Then forbidden wins
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(snapshot()).toEqual(before);
    });

    it.each([
      ['listId abc', 'abc', {}, ['listId']],
      ['a 35-character listId', LIST_ID.slice(0, -1), {}, ['listId']],
      [
        'no itemIds',
        LIST_ID,
        { body: batchBodyWithout('itemIds') },
        ['itemIds'],
      ],
      [
        'itemIds "x"',
        LIST_ID,
        { body: batchBody({ itemIds: 'x' }) },
        ['itemIds'],
      ],
      [
        'itemIds []',
        LIST_ID,
        { body: batchBody({ itemIds: [] }) },
        ['itemIds'],
      ],
      [
        '501 valid ids',
        LIST_ID,
        {
          body: batchBody({
            itemIds: Array.from({ length: 501 }, (_, i) => itemId(0x1000 + i)),
          }),
        },
        ['itemIds'],
      ],
      [
        'a valid id then "bad"',
        LIST_ID,
        { body: batchBody({ itemIds: [ITEM_1, 'bad'] }) },
        ['itemIds.1'],
      ],
      [
        'an SQL-looking id',
        LIST_ID,
        { body: batchBody({ itemIds: ["1' OR '1'='1"] }) },
        ['itemIds.0'],
      ],
      [
        'no changedAt',
        LIST_ID,
        { body: batchBodyWithout('changedAt') },
        ['changedAt'],
      ],
      ...(
        [
          '',
          '2026-11-13',
          '2026-11-13T10:00:00',
          'not-a-date',
          1731492000000,
          null,
        ] as unknown[]
      ).map((value): [string, string, Send, string[]] => [
        `changedAt ${JSON.stringify(value)}`,
        LIST_ID,
        { body: batchBody({ changedAt: value }) },
        ['changedAt'],
      ]),
      ['Content-Type text/plain', LIST_ID, { contentType: 'text/plain' }, ['']],
      [
        'Content-Type form-urlencoded',
        LIST_ID,
        { contentType: 'application/x-www-form-urlencoded' },
        [''],
      ],
      ['no Content-Type', LIST_ID, { contentType: null }, ['']],
      ['body "{"', LIST_ID, { raw: '{' }, ['']],
      ['an empty body', LIST_ID, { raw: '' }, ['']],
      ['JSON body []', LIST_ID, { raw: '[]' }, ['']],
      ['JSON body null', LIST_ID, { raw: 'null' }, ['']],
      ['JSON body "x"', LIST_ID, { raw: '"x"' }, ['']],
    ] as Array<[string, string, Send, string[]]>)(
      'POST delete-batch with %s returns 400 and deletes nothing',
      async (_label, list, send, paths) => {
        // Given a live item and a subscriber
        seedItem({ id: ITEM_1 });
        const events = watch(h1);
        const before = snapshot();

        // When the batch is sent
        const res = await batch(list, send.body ?? batchBody(), send);

        // Then each failing path is reported
        expect(res.status).toBe(400);
        const error = (await res.json()).error;
        expect(error.code).toBe('validation_failed');
        const details = error.details as Array<{ path: string }>;
        expect(details.map((d) => d.path)).toEqual(paths);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('POST delete-batch with a wrong content type returns the fixed message', async () => {
      // Given a JSON body sent as text/plain
      // When the batch is sent
      const res = await batch(LIST_ID, batchBody(), {
        contentType: 'text/plain',
      });

      // Then the fixed content type message is returned
      expect(await res.json()).toEqual(
        validation({ path: '', message: CONTENT_TYPE }),
      );
    });

    it('POST delete-batch with invalid JSON returns the fixed message', async () => {
      // Given a malformed JSON body
      // When the batch is sent
      const res = await batch(LIST_ID, undefined, { raw: '{' });

      // Then the fixed invalid JSON message is returned
      expect(await res.json()).toEqual(
        validation({ path: '', message: INVALID_JSON }),
      );
    });

    it('POST delete-batch with Content-Type charset and an extra body field is accepted', async () => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When a charset content type and a householdId field are sent
      const res = await batch(LIST_ID, batchBody({ householdId: h2 }), {
        contentType: 'application/json; charset=utf-8',
      });

      // Then it is accepted
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBe(NEWER_MS);
    });

    it('POST delete-batch with several invalid inputs reports every path', async () => {
      // Given an invalid list id and an empty object
      // When the batch is sent
      const res = await batch('abc', {});

      // Then listId, itemIds and changedAt are reported
      const details = (await res.json()).error.details as Array<{
        path: string;
      }>;
      expect(details.map((d) => d.path).sort()).toEqual(
        ['changedAt', 'itemIds', 'listId'].sort(),
      );
    });
  });

  describe('household isolation and roles', () => {
    it.each(
      routes.flatMap((r) =>
        (['a1', 'a2'] as const).map((who) => [r.label, who, r] as const),
      ),
    )('%s as %s succeeds with the same outcome', async (_label, who, route) => {
      // Given a live item, a subscriber and a caller with the given role
      seedItem({ id: ITEM_1 });
      const events = watch(h1);
      const v = counter();

      // When the caller uses the route
      const res = await route.send(LIST_ID, { as: who });

      // Then the status and the effect are identical for both roles
      expect(res.status).toBe(route.ok);
      expect(counter()).toBe(v + 1);
      expect(events).toEqual([v + 1]);
    });

    it('PUT item as owner and member returns the same body for the same state', async () => {
      // Given two lists of household one
      // When the owner and the member each create an item
      const owner = await putItem(LIST_ID, NEW_ID, putBody(), { as: 'a1' });
      const member = await putItem(LIST_2, itemId(0x21), putBody(), {
        as: 'a2',
      });

      // Then both succeed with the same shape
      expect(owner.status).toBe(201);
      expect(member.status).toBe(201);
      const a = await owner.json();
      const b = await member.json();
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      expect(Object.keys(a.item).sort()).toEqual(Object.keys(b.item).sort());
    });

    it.each(
      routes.flatMap((r) =>
        (
          [
            ['an unknown list', MISSING_LIST],
            ['a soft-deleted list', LIST_DELETED],
          ] as Array<[string, string]>
        ).map(([label, list]) => [r.label, label, r, list] as const),
      ),
    )(
      '%s on %s returns 404 and writes nothing',
      async (_route, _label, route, list) => {
        // Given an item and a subscriber
        seedItem({ id: ITEM_1 });
        const events = watch(h1);
        const before = snapshot();

        // When the route targets the missing or deleted list
        const res = await route.send(list);

        // Then not_found and nothing changes
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it.each(
      routes.flatMap((r) =>
        (
          [
            ['a live list of household two', LIST_B],
            ['a soft-deleted list of household two', LIST_B_DELETED],
          ] as Array<[string, string]>
        ).map(([label, list]) => [r.label, label, r, list] as const),
      ),
    )(
      '%s on %s returns 403 and writes nothing',
      async (_route, _label, route, list) => {
        // Given household two's list and subscribers
        seedItem({ id: FOREIGN_ID, listId: LIST_B, householdId: h2 });
        const events1 = watch(h1);
        const events2 = watch(h2);
        const before = snapshot();

        // When household one uses the route
        const res = await route.send(list);

        // Then forbidden and nothing changes or leaks
        expect(res.status).toBe(403);
        expect(await res.text()).toBe(FORBIDDEN);
        expect(snapshot()).toEqual(before);
        expect(events1).toEqual([]);
        expect(events2).toEqual([]);
      },
    );

    it.each(
      (['PUT', 'DELETE'] as const).flatMap((method) =>
        (
          [
            ['live', null],
            ['soft-deleted', STORED],
          ] as Array<[string, number | null]>
        ).map(([state, deletedAt]) => [method, state, deletedAt] as const),
      ),
    )(
      '%s of a %s item of household two through an own list returns 403',
      async (method, _state, deletedAt) => {
        // Given an item of household two
        seedItem({
          id: FOREIGN_ID,
          listId: LIST_B,
          householdId: h2,
          deletedAt,
        });
        const events = watch(h2);
        const before = snapshot();

        // When household one targets it through its own list
        const res =
          method === 'PUT'
            ? await putItem(LIST_ID, FOREIGN_ID, putBody())
            : await delItem(LIST_ID, FOREIGN_ID, NEWER);

        // Then it is forbidden and the item is unchanged
        expect(res.status).toBe(403);
        expect(await res.text()).toBe(FORBIDDEN);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it.each(['PUT', 'DELETE'] as const)(
      '%s of a foreign item through a missing list returns 404',
      async (method) => {
        // Given an item of household two
        seedItem({ id: FOREIGN_ID, listId: LIST_B, householdId: h2 });
        const before = snapshot();

        // When household one targets it through an unknown list
        const res =
          method === 'PUT'
            ? await putItem(MISSING_LIST, FOREIGN_ID, putBody())
            : await delItem(MISSING_LIST, FOREIGN_ID, NEWER);

        // Then the list is reported first
        expect(res.status).toBe(404);
        expect(snapshot()).toEqual(before);
      },
    );

    it.each(routes)(
      '$label for a user without a household returns 403',
      async (route) => {
        // Given a signed-in user whose membership was removed
        seedItem({ id: ITEM_1 });
        await cookieFor('n1');
        const before = snapshot();

        // When they use the route
        const res = await route.send(LIST_ID, { as: 'n1' });

        // Then forbidden and nothing changes
        expect(res.status).toBe(403);
        expect(await res.text()).toBe(FORBIDDEN);
        expect(snapshot()).toEqual(before);
      },
    );

    it('household two sees only its own items and suggestions after household one writes', async () => {
      // Given household two has a list and a suggestion
      seedSuggestion(h2, 'milk', 5);
      const events2 = watch(h2);
      const theirs = suggestion(h2, 'milk');

      // When household one creates "milk"
      const res = await putItem(LIST_ID, NEW_ID, putBody({ name: 'milk' }));

      // Then household two's suggestion and events are untouched
      expect(res.status).toBe(201);
      expect(suggestion(h2, 'milk')).toEqual(theirs);
      expect(suggestion(h1, 'milk')?.useCount).toBe(1);
      expect(events2).toEqual([]);
    });
  });

  describe('missing session', () => {
    it.each(
      routes.flatMap((r) =>
        (
          [
            ['a missing cookie', null],
            ['a garbage session cookie', 'better-auth.session_token=garbage'],
          ] as Array<[string, string | null]>
        ).map(([label, cookie]) => [r.label, label, r, cookie] as const),
      ),
    )(
      '%s with %s returns 401 with the full body',
      async (_route, _label, route, cookie) => {
        // Given no valid session
        seedItem({ id: ITEM_1 });
        const events = watch(h1);
        const before = snapshot();

        // When a valid request is sent
        const res = await route.send(LIST_ID, { cookie });

        // Then 401 with the exact body and no mutation
        expect(res.status).toBe(401);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.text()).toBe(UNAUTHENTICATED);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it.each(routes)(
      '$label with invalid input and no session returns 401 not 400',
      async (route) => {
        // Given no session
        // When invalid input is sent
        const res = await route.bad({ cookie: null });

        // Then authentication is checked before validation
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(UNAUTHENTICATED);
      },
    );
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

    it.each(
      routes.flatMap((r) =>
        rejected.map(([label, o]) => [r.label, label, r, o] as const),
      ),
    )(
      '%s with %s returns 403 before session, validation or mutation',
      async (_route, _label, route, extra) => {
        // Given an item and a subscriber
        seedItem({ id: ITEM_1 });
        const events = watch(h1);
        const before = snapshot();

        // When a valid request, an invalid one and an unauthenticated one are sent
        const valid = await route.send(LIST_ID, extra);
        const invalid = await route.bad(extra);
        const anonymous = await route.send(LIST_ID, { ...extra, cookie: null });

        // Then all are forbidden and nothing changes
        for (const res of [valid, invalid, anonymous]) {
          expect(res.status).toBe(403);
          expect(await res.text()).toBe(FORBIDDEN);
        }
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it.each(
      routes.flatMap((r) =>
        (
          [
            ['no Origin and no Sec-Fetch-Site', { origin: null }],
            [
              'no Origin and Sec-Fetch-Site same-origin',
              { origin: null, site: 'same-origin' },
            ],
          ] as Array<[string, Send]>
        ).map(([label, o]) => [r.label, label, r, o] as const),
      ),
    )('%s with %s is accepted', async (_route, _label, route, extra) => {
      // Given a live item
      seedItem({ id: ITEM_1 });

      // When the request satisfies the origin rule
      const res = await route.send(LIST_ID, extra);

      // Then it reaches the handler
      expect(res.status).toBe(route.ok);
    });
  });

  describe('item on another list of the household', () => {
    const X = OTHER_LIST_ID;

    type Row = [string, () => void, () => Promise<Response>];
    const rows: Row[] = [
      [
        'PUT of a live item with a new name',
        () => seedItem({ id: X, listId: LIST_2 }),
        () => putItem(LIST_ID, X, putBody({ name: 'Renamed' })),
      ],
      [
        'PUT of a live item with an older changedAt',
        () => seedItem({ id: X, listId: LIST_2 }),
        () => putItem(LIST_ID, X, putBody({ changedAt: OLDER })),
      ],
      [
        'PUT of a live item with the same name and state',
        () => seedItem({ id: X, listId: LIST_2, name: 'Ice cream' }),
        () => putItem(LIST_ID, X, putBody({ changedAt: iso(STORED) })),
      ],
      [
        'PUT of a soft-deleted item',
        () => seedItem({ id: X, listId: LIST_2, deletedAt: STORED }),
        () => putItem(LIST_ID, X, putBody()),
      ],
      [
        'PUT of an item on a soft-deleted list',
        () => seedItem({ id: X, listId: LIST_DELETED }),
        () => putItem(LIST_ID, X, putBody()),
      ],
      [
        'DELETE of a live item with a newer changedAt',
        () => seedItem({ id: X, listId: LIST_2 }),
        () => delItem(LIST_ID, X, NEWER),
      ],
      [
        'DELETE of a live item with an older changedAt',
        () => seedItem({ id: X, listId: LIST_2 }),
        () => delItem(LIST_ID, X, OLDER),
      ],
      [
        'DELETE of a soft-deleted item',
        () => seedItem({ id: X, listId: LIST_2, deletedAt: STORED }),
        () => delItem(LIST_ID, X, NEWER),
      ],
      [
        'DELETE of an item on a soft-deleted list',
        () => seedItem({ id: X, listId: LIST_DELETED }),
        () => delItem(LIST_ID, X, NEWER),
      ],
    ];

    it.each(rows)(
      '%s returns 409 item_on_other_list and changes nothing',
      async (_label, seed, send) => {
        // Given an item on another list of the household and a subscriber
        seed();
        seedSuggestion(h1, 'ice cream', 2);
        const events = watch(h1);
        const before = snapshot();

        // When it is targeted through the list
        const res = await send();

        // Then 409 with the exact body and no mutation, version, event or suggestion change
        expect(res.status).toBe(409);
        expect(await res.text()).toBe(ITEM_ON_OTHER_LIST);
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );

    it('PUT item with a cross-list id does not merge into a same-name item', async () => {
      // Given "milk" on the list and X named "milk" on another list
      seedItem({ id: ITEM_1, name: 'milk' });
      seedItem({ id: X, listId: LIST_2, name: 'milk' });
      const before = snapshot();

      // When X is put through the list as milk with a newer changedAt
      const res = await putItem(
        LIST_ID,
        X,
        putBody({ name: 'milk', crossedOff: true }),
      );

      // Then 409 and neither item changes
      expect(res.status).toBe(409);
      expect(await res.text()).toBe(ITEM_ON_OTHER_LIST);
      expect(snapshot()).toEqual(before);
    });

    it.each(
      routes.flatMap((r) =>
        (
          [
            ['an unknown list', MISSING_LIST, 404, NOT_FOUND],
            ['a soft-deleted list', LIST_DELETED, 404, NOT_FOUND],
            ['a list of household two', LIST_B, 403, FORBIDDEN],
          ] as Array<[string, string, number, string]>
        ).map(
          ([label, list, status, text]) =>
            [r.label, label, r, list, status, text] as const,
        ),
      ),
    )(
      '%s with a cross-list id through %s is answered by the list check',
      async (_route, _label, route, list, status, text) => {
        // Given an item on another list of the household
        seedItem({ id: ITEM_1 });
        seedItem({ id: X, listId: LIST_2 });
        const before = snapshot();

        // When the route targets the list with the cross-list id
        const res =
          route.label === 'PUT item'
            ? await putItem(list, X, putBody())
            : route.label === 'DELETE item'
              ? await delItem(list, X, NEWER)
              : await batch(list, batchBody({ itemIds: [ITEM_1, X] }));

        // Then the list or household check wins
        expect(res.status).toBe(status);
        expect(await res.text()).toBe(text);
        expect(snapshot()).toEqual(before);
      },
    );

    it('PUT item replayed after a cross-list 409 returns the same conflict', async () => {
      // Given a cross-list 409
      seedItem({ id: X, listId: LIST_2 });
      const first = await putItem(LIST_ID, X, putBody());
      const before = snapshot();

      // When the identical request is replayed
      const second = await putItem(LIST_ID, X, putBody());

      // Then the same error and no change
      expect(first.status).toBe(409);
      expect(second.status).toBe(409);
      expect(await second.text()).toBe(ITEM_ON_OTHER_LIST);
      expect(snapshot()).toEqual(before);
    });
  });

  describe('suggestion history', () => {
    it('PUT item creating an item inserts a suggestion with use_count 1 and the display name', async () => {
      // Given no suggestions
      // When "  Oat   milk " is created
      const res = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: '  Oat   milk ' }),
      );

      // Then the suggestion is inserted for the household
      expect(res.status).toBe(201);
      expect(suggestions()).toEqual([
        {
          householdId: h1,
          nameKey: 'oat milk',
          name: 'Oat milk',
          useCount: 1,
          lastUsedAt: NOW,
        },
      ]);
    });

    it('PUT item creating an item with an existing suggestion increments it and keeps the stored name', async () => {
      // Given suggestion "milk" with use_count 2
      seedSuggestion(h1, 'milk', 2);

      // When "MILK" is created
      const res = await putItem(LIST_ID, NEW_ID, putBody({ name: 'MILK' }));

      // Then use_count is 3, last_used_at is now and the name is kept
      expect(res.status).toBe(201);
      expect(suggestion(h1, 'milk')).toEqual({
        householdId: h1,
        nameKey: 'milk',
        name: 'milk',
        useCount: 3,
        lastUsedAt: NOW,
      });
    });

    it('PUT item creating the same name on two lists increments the suggestion each time', async () => {
      // Given a created "Milk" on one list
      await putItem(LIST_ID, NEW_ID, putBody({ name: 'Milk' }));

      // When "Milk" is created on another list
      const res = await putItem(
        LIST_2,
        itemId(0x21),
        putBody({ name: 'Milk' }),
      );

      // Then use_count is 2
      expect(res.status).toBe(201);
      expect(suggestion(h1, 'milk')?.useCount).toBe(2);
    });

    it.each([
      ['a live item renamed to another name', null, 'Oat milk', 'oat milk'],
      ['a live item renamed with a case-only change', null, 'Milk', 'milk'],
      [
        'a soft-deleted item undeleted with another name',
        STORED,
        'Butter',
        'butter',
      ],
    ])(
      'PUT item on %s upserts the new key',
      async (_label, deletedAt, newName, key) => {
        // Given an item "milk" and an existing suggestion for the new key
        seedItem({ id: ITEM_1, name: 'milk', deletedAt });
        seedSuggestion(h1, key, 4);

        // When it is renamed with a newer changedAt
        const res = await putItem(
          LIST_ID,
          ITEM_1,
          putBody({ name: newName, changedAt: NEWER }),
        );

        // Then the suggestion count increases by exactly 1 and the stored name is kept
        expect(res.status).toBe(200);
        expect((await res.json()).applied).toBe(true);
        expect(suggestion(h1, key)).toMatchObject({
          name: key,
          useCount: 5,
          lastUsedAt: NOW,
        });
        expect(suggestions()).toHaveLength(1);
      },
    );

    const world = () => {
      seedItem({ id: ITEM_1, name: 'milk' });
      seedItem({ id: ITEM_2, name: 'eggs', crossedOffAt: STORED });
      seedItem({ id: ITEM_3, name: 'butter', deletedAt: STORED });
      seedItem({ id: OTHER_LIST_ID, listId: LIST_2, name: 'rice' });
      seedSuggestion(h1, 'milk', 2);
    };

    it.each([
      [
        'a cross-off',
        200,
        () =>
          putItem(LIST_ID, ITEM_1, putBody({ name: 'milk', crossedOff: true })),
      ],
      [
        'a restore',
        200,
        () =>
          putItem(
            LIST_ID,
            ITEM_2,
            putBody({ name: 'eggs', crossedOff: false }),
          ),
      ],
      [
        'an undelete with the same name',
        200,
        () => putItem(LIST_ID, ITEM_3, putBody({ name: 'butter' })),
      ],
      [
        'a merged create',
        200,
        () =>
          putItem(LIST_ID, NEW_ID, putBody({ name: 'MILK', crossedOff: true })),
      ],
      [
        'a stale rename',
        200,
        () =>
          putItem(LIST_ID, ITEM_1, putBody({ name: 'Oat', changedAt: OLDER })),
      ],
      [
        'a state-identical PUT',
        200,
        () => putItem(LIST_ID, ITEM_1, putBody({ name: 'milk' })),
      ],
      [
        'a rename that conflicts',
        409,
        () => putItem(LIST_ID, ITEM_2, putBody({ name: 'milk' })),
      ],
      [
        'a cross-list id',
        409,
        () => putItem(LIST_ID, OTHER_LIST_ID, putBody({ name: 'Oat' })),
      ],
      [
        'an invalid PUT',
        400,
        () => putItem(LIST_ID, ITEM_1, putBody({ name: '' })),
      ],
      [
        'a PUT on a missing list',
        404,
        () => putItem(MISSING_LIST, NEW_ID, putBody({ name: 'Oat' })),
      ],
      [
        'a PUT on a list of household two',
        403,
        () => putItem(LIST_B, NEW_ID, putBody({ name: 'Oat' })),
      ],
      [
        'a PUT without a session',
        401,
        () =>
          putItem(LIST_ID, NEW_ID, putBody({ name: 'Oat' }), { cookie: null }),
      ],
      ['a DELETE', 204, () => delItem(LIST_ID, ITEM_1, NEWER)],
      [
        'a delete-batch',
        204,
        () => batch(LIST_ID, batchBody({ itemIds: [ITEM_1, ITEM_2] })),
      ],
    ] as Array<[string, number, () => Promise<Response>]>)(
      '%s leaves item_suggestion unchanged',
      async (_label, status, send) => {
        // Given a household with suggestions
        world();
        const before = suggestions();

        // When the request is sent
        const res = await send();

        // Then suggestions are unchanged
        expect(res.status).toBe(status);
        expect(suggestions()).toEqual(before);
      },
    );
  });

  describe('replay idempotency', () => {
    interface ReplayCase {
      label: string;
      setup: () => void;
      send: () => Promise<Response>;
      first: number;
      replay: number;
    }

    const stock = () => {
      seedItem({ id: ITEM_1, name: 'milk' });
      seedItem({ id: ITEM_2, name: 'bread' });
    };

    const cases: ReplayCase[] = [
      {
        label: 'PUT create',
        setup: () => undefined,
        send: () => putItem(LIST_ID, NEW_ID, putBody({ name: 'Bread' })),
        first: 201,
        replay: 200,
      },
      {
        label: 'PUT create with a future changedAt',
        setup: () => undefined,
        send: () =>
          putItem(
            LIST_ID,
            NEW_ID,
            putBody({ name: 'Bread', changedAt: FUTURE }),
          ),
        first: 201,
        replay: 200,
      },
      {
        label: 'PUT rename',
        setup: stock,
        send: () => putItem(LIST_ID, ITEM_1, putBody({ name: 'Oat milk' })),
        first: 200,
        replay: 200,
      },
      {
        label: 'PUT cross-off',
        setup: stock,
        send: () =>
          putItem(LIST_ID, ITEM_1, putBody({ name: 'milk', crossedOff: true })),
        first: 200,
        replay: 200,
      },
      {
        label: 'PUT cross-off with a future changedAt',
        setup: stock,
        send: () =>
          putItem(
            LIST_ID,
            ITEM_1,
            putBody({ name: 'milk', crossedOff: true, changedAt: FUTURE }),
          ),
        first: 200,
        replay: 200,
      },
      {
        label: 'PUT restore',
        setup: () =>
          seedItem({ id: ITEM_1, name: 'milk', crossedOffAt: STORED }),
        send: () =>
          putItem(
            LIST_ID,
            ITEM_1,
            putBody({ name: 'milk', crossedOff: false }),
          ),
        first: 200,
        replay: 200,
      },
      {
        label: 'PUT undelete',
        setup: () => seedItem({ id: ITEM_1, name: 'milk', deletedAt: STORED }),
        send: () => putItem(LIST_ID, ITEM_1, putBody({ name: 'milk' })),
        first: 200,
        replay: 200,
      },
      {
        label: 'PUT merged create',
        setup: stock,
        send: () =>
          putItem(LIST_ID, NEW_ID, putBody({ name: 'MILK', crossedOff: true })),
        first: 200,
        replay: 200,
      },
      {
        label: 'stale PUT',
        setup: stock,
        send: () =>
          putItem(LIST_ID, ITEM_1, putBody({ name: 'Oat', changedAt: OLDER })),
        first: 200,
        replay: 200,
      },
      {
        label: 'PUT rename to a taken name',
        setup: stock,
        send: () => putItem(LIST_ID, ITEM_2, putBody({ name: 'milk' })),
        first: 409,
        replay: 409,
      },
      {
        label: 'PUT on an unknown list',
        setup: stock,
        send: () => putItem(MISSING_LIST, NEW_ID, putBody()),
        first: 404,
        replay: 404,
      },
      {
        label: 'PUT on a list of household two',
        setup: stock,
        send: () => putItem(LIST_B, NEW_ID, putBody()),
        first: 403,
        replay: 403,
      },
      {
        label: 'PUT with invalid input',
        setup: stock,
        send: () => putItem(LIST_ID, ITEM_1, putBody({ name: '' })),
        first: 400,
        replay: 400,
      },
      {
        label: 'DELETE',
        setup: stock,
        send: () => delItem(LIST_ID, ITEM_1, NEWER),
        first: 204,
        replay: 204,
      },
      {
        label: 'DELETE with a future changedAt',
        setup: stock,
        send: () => delItem(LIST_ID, ITEM_1, FUTURE),
        first: 204,
        replay: 204,
      },
      {
        label: 'stale DELETE',
        setup: stock,
        send: () => delItem(LIST_ID, ITEM_1, OLDER),
        first: 200,
        replay: 200,
      },
      {
        label: 'DELETE on an unknown list',
        setup: stock,
        send: () => delItem(MISSING_LIST, ITEM_1, NEWER),
        first: 404,
        replay: 404,
      },
      {
        label: 'delete-batch',
        setup: stock,
        send: () => batch(LIST_ID, batchBody({ itemIds: [ITEM_1, ITEM_2] })),
        first: 204,
        replay: 204,
      },
      {
        label: 'delete-batch with a future changedAt',
        setup: stock,
        send: () =>
          batch(LIST_ID, batchBody({ itemIds: [ITEM_1], changedAt: FUTURE })),
        first: 204,
        replay: 204,
      },
      {
        label: 'delete-batch with a foreign id',
        setup: () => {
          stock();
          seedItem({ id: FOREIGN_ID, listId: LIST_B, householdId: h2 });
        },
        send: () =>
          batch(LIST_ID, batchBody({ itemIds: [ITEM_1, FOREIGN_ID] })),
        first: 403,
        replay: 403,
      },
      {
        label: 'delete-batch on a soft-deleted list',
        setup: stock,
        send: () => batch(LIST_DELETED, batchBody()),
        first: 404,
        replay: 404,
      },
    ];

    it.each(cases)(
      '$label replayed has no extra effect',
      async ({ setup, send, first, replay }) => {
        // Given a request that already completed
        setup();
        const events = watch(h1);
        const firstRes = await send();
        expect(firstRes.status).toBe(first);
        const firstText = await firstRes.text();
        const before = snapshot();
        const published = [...events];

        // When the identical request is replayed
        const secondRes = await send();

        // Then the outcome is the same and nothing changes
        expect(secondRes.status).toBe(replay);
        const secondText = await secondRes.text();
        if (first === 200 || first === 201) {
          expect(JSON.parse(secondText)).toEqual({
            ...JSON.parse(firstText),
            applied: false,
          });
        } else {
          expect(secondText).toBe(firstText);
        }
        expect(snapshot()).toEqual(before);
        expect(events).toEqual(published);
      },
    );

    it('PUT replay after a newer change returns 200 applied false with the newer stored item', async () => {
      // Given a cross-off at T+10m followed by a restore at T+30m by another user
      seedItem({ id: ITEM_1, name: 'milk' });
      const crossOff = putBody({
        name: 'milk',
        crossedOff: true,
        changedAt: iso(minutes(-50)),
      });
      expect((await putItem(LIST_ID, ITEM_1, crossOff)).status).toBe(200);
      const restore = await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', crossedOff: false, changedAt: NEWER }),
        { as: 'a2' },
      );
      expect(restore.status).toBe(200);
      const before = snapshot();

      // When the cross-off is replayed
      const res = await putItem(LIST_ID, ITEM_1, crossOff);

      // Then it is ignored and the restored item is returned
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applied).toBe(false);
      expect(body.item).toMatchObject({
        crossedOffAt: null,
        updatedAt: NEWER,
      });
      expect(snapshot()).toEqual(before);
    });

    it('DELETE replay after a newer change returns 200 applied false with the newer item', async () => {
      // Given a delete at T+10m after which the item was undeleted at T+30m
      seedItem({ id: ITEM_1, name: 'milk' });
      const staleDelete = iso(minutes(-50));
      expect((await delItem(LIST_ID, ITEM_1, staleDelete)).status).toBe(204);
      await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: NEWER }),
      );
      const before = snapshot();

      // When the delete is replayed
      const res = await delItem(LIST_ID, ITEM_1, staleDelete);

      // Then the live newer item is returned with applied false
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.applied).toBe(false);
      expect(body.item).toMatchObject({ deletedAt: null, updatedAt: NEWER });
      expect(snapshot()).toEqual(before);
    });

    it('delete-batch replay after a newer change skips the item', async () => {
      // Given a batch at T+10m after which the item was undeleted at T+30m
      seedItem({ id: ITEM_1, name: 'milk' });
      const at = iso(minutes(-50));
      expect((await batch(LIST_ID, batchBody({ changedAt: at }))).status).toBe(
        204,
      );
      await putItem(
        LIST_ID,
        ITEM_1,
        putBody({ name: 'milk', changedAt: NEWER }),
      );
      const events = watch(h1);
      const before = snapshot();

      // When the batch is replayed
      const res = await batch(LIST_ID, batchBody({ changedAt: at }));

      // Then 204 and the item stays live
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.deletedAt).toBeNull();
      expect(snapshot()).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('versions, events and atomicity', () => {
    it('publishes one version per applied write after commit and only to the household', async () => {
      // Given two subscribers on household one, one on household two, and an observer
      const first = watch(h1);
      const second = watch(h1);
      const other = watch(h2);
      const observed: Array<{
        version: number;
        counter: number;
        inTransaction: boolean;
        rowCommitted: boolean;
      }> = [];
      unsubscribers.push(
        hub.subscribe(h1, (version) =>
          observed.push({
            version,
            counter: counter(),
            inTransaction: ctx.h.sqlite.inTransaction,
            rowCommitted: itemRow(NEW_ID) !== undefined,
          }),
        ),
      );
      const v = counter();

      // When an item is created, renamed, crossed off, deleted and batch-deleted
      const created = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: 'milk', changedAt: iso(minutes(-50)) }),
      );
      const renamed = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({ name: 'oat milk', changedAt: iso(minutes(-45)) }),
      );
      const crossed = await putItem(
        LIST_ID,
        NEW_ID,
        putBody({
          name: 'oat milk',
          crossedOff: true,
          changedAt: iso(minutes(-40)),
        }),
      );
      const deleted = await delItem(LIST_ID, NEW_ID, iso(minutes(-35)));
      seedItem({ id: ITEM_1, updatedAt: STORED });
      const batched = await batch(LIST_ID, batchBody({ changedAt: NEWER }));

      // Then every subscriber of household one sees consecutive versions, household two none
      expect((await created.json()).item.version).toBe(v + 1);
      expect((await renamed.json()).item.version).toBe(v + 2);
      expect((await crossed.json()).item.version).toBe(v + 3);
      expect(deleted.status).toBe(204);
      expect(batched.status).toBe(204);
      // seedItem consumed v + 5 directly, so the batch got v + 6
      expect(first).toEqual([v + 1, v + 2, v + 3, v + 4, v + 6]);
      expect(second).toEqual(first);
      expect(other).toEqual([]);
      expect(observed.map((o) => o.version)).toEqual(first);
      expect(observed.every((o) => !o.inTransaction)).toBe(true);
      expect(observed.every((o) => o.counter === o.version)).toBe(true);
      expect(observed[0]?.rowCommitted).toBe(true);
    });

    it('delete-batch gives every deleted row the same version and publishes it once', async () => {
      // Given two eligible items and counter value V
      seedItem({ id: ITEM_1 });
      seedItem({ id: ITEM_2 });
      const events = watch(h1);
      const v = counter();

      // When both are batch-deleted
      const res = await batch(
        LIST_ID,
        batchBody({ itemIds: [ITEM_1, ITEM_2] }),
      );

      // Then both have version V+1, the counter is V+1 and one event is published
      expect(res.status).toBe(204);
      expect(itemRow(ITEM_1)?.version).toBe(v + 1);
      expect(itemRow(ITEM_2)?.version).toBe(v + 1);
      expect(counter()).toBe(v + 1);
      expect(events).toEqual([v + 1]);
    });

    it('publishes nothing for stale, no-op, missing, empty-batch and error requests', async () => {
      // Given items and subscribers on both households
      seedItem({ id: ITEM_1, name: 'milk' });
      seedItem({ id: ITEM_2, name: 'bread', deletedAt: STORED });
      seedItem({ id: FOREIGN_ID, listId: LIST_B, householdId: h2 });
      const events1 = watch(h1);
      const events2 = watch(h2);
      const before = snapshot();

      // When requests that apply nothing are sent
      const results = [
        await putItem(
          LIST_ID,
          ITEM_1,
          putBody({ name: 'Oat', changedAt: OLDER }),
        ),
        await putItem(LIST_ID, ITEM_1, putBody({ name: 'milk' })),
        await delItem(LIST_ID, UNKNOWN_ID, NEWER),
        await delItem(LIST_ID, ITEM_2, NEWER),
        await delItem(LIST_ID, ITEM_1, OLDER),
        await batch(LIST_ID, batchBody({ itemIds: [UNKNOWN_ID, ITEM_2] })),
        await putItem(LIST_ID, NEW_ID, putBody({ name: '' })),
        await putItem(LIST_ID, FOREIGN_ID, putBody()),
        await putItem(MISSING_LIST, NEW_ID, putBody()),
      ];

      // Then no version is assigned or published
      expect(results.map((r) => r.status)).toEqual([
        200, 200, 204, 204, 200, 204, 400, 403, 404,
      ]);
      expect(snapshot()).toEqual(before);
      expect(events1).toEqual([]);
      expect(events2).toEqual([]);
    });

    it.each([
      [
        'PUT create when the suggestion upsert fails',
        () => failOn('INSERT', 'item_suggestion'),
        () => putItem(LIST_ID, NEW_ID, putBody()),
      ],
      [
        'PUT rename when the suggestion upsert fails',
        () => {
          seedItem({ id: ITEM_1, name: 'milk' });
          failOn('INSERT', 'item_suggestion');
        },
        () => putItem(LIST_ID, ITEM_1, putBody({ name: 'Oat milk' })),
      ],
      [
        'PUT cross-off when the item update fails',
        () => {
          seedItem({ id: ITEM_1, name: 'milk' });
          failOn('UPDATE', 'list_item');
        },
        () =>
          putItem(LIST_ID, ITEM_1, putBody({ name: 'milk', crossedOff: true })),
      ],
      [
        'PUT merge when the item update fails',
        () => {
          seedItem({ id: ITEM_1, name: 'milk' });
          failOn('UPDATE', 'list_item');
        },
        () =>
          putItem(LIST_ID, NEW_ID, putBody({ name: 'milk', crossedOff: true })),
      ],
      [
        'DELETE when the item update fails',
        () => {
          seedItem({ id: ITEM_1 });
          failOn('UPDATE', 'list_item');
        },
        () => delItem(LIST_ID, ITEM_1, NEWER),
      ],
      [
        'delete-batch when the item update fails',
        () => {
          seedItem({ id: ITEM_1 });
          seedItem({ id: ITEM_2 });
          failOn('UPDATE', 'list_item');
        },
        () => batch(LIST_ID, batchBody({ itemIds: [ITEM_1, ITEM_2] })),
      ],
    ] as Array<[string, () => void, () => Promise<Response>]>)(
      '%s rolls back with a generic 500 and no event',
      async (_label, arrange, send) => {
        // Given a failing statement inside the transaction and a subscriber
        arrange();
        const events = watch(h1);
        const before = snapshot();

        // When the request is sent
        const res = await send();

        // Then the exact 500 body, nothing persisted and nothing published
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).toBe(INTERNAL);
        expect(text).not.toContain('secret-trigger-detail');
        expect(snapshot()).toEqual(before);
        expect(events).toEqual([]);
      },
    );
  });
});
