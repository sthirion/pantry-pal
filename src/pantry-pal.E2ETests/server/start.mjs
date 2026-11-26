// Starts the real API on a temporary SQLite database with seeded personas, serving the built frontend.
// Requires `npm run build` first: it imports the compiled API and serves the frontend's `dist`.
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// E2E_API_DIST / E2E_FRONTEND_DIST override the build locations (used by the setup-failure spec).
const apiDist = path.resolve(
  process.env.E2E_API_DIST ?? path.join(here, '../../pantry-pal/dist'),
);
const frontendDist = path.resolve(
  process.env.E2E_FRONTEND_DIST ??
    path.join(here, '../../pantry-pal.Frontend/dist'),
);
const origin = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:5199';

function fail(message) {
  console.error(`E2E server setup failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(apiDist, 'server.js'))) {
  fail('the API is not built. Run "npm run build" first.');
}
if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
  fail('the frontend is not built. Run "npm run build" first.');
}

const load = (file) => import(pathToFileURL(path.join(apiDist, file)).href);
const { createDatabase, openSqlite, runMigrations } =
  await load('db/database.js');
const { createHousehold, createUser } = await load('admin-commands.js');
const { itemSuggestion } = await load('db/schema.js');
const { startServer } = await load('server.js');

const seed = JSON.parse(
  fs.readFileSync(path.join(here, 'personas.json'), 'utf8'),
);
// E2E_DB_PATH (set by playwright.config.ts) lets specs open this database; without it a throwaway temp directory is used.
const configuredDbPath = process.env.E2E_DB_PATH;
const tmp = configuredDbPath
  ? undefined
  : fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-pal-e2e-'));
const dbPath = configuredDbPath ?? path.join(tmp, 'pantry.db');
function removeDatabaseFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
removeDatabaseFiles();

const sqlite = openSqlite(dbPath);
const db = createDatabase(sqlite);
runMigrations(db);

const householdIds = {};
for (const [key, name] of Object.entries(seed.households)) {
  householdIds[key] = createHousehold(db, { name });
}
for (const persona of Object.values(seed.personas)) {
  await createUser(
    db,
    {
      email: persona.email,
      name: persona.name,
      household: householdIds[persona.household],
    },
    async () => persona.password,
  );
}
// One two-member household per Playwright worker for the sync journeys (see syncPair in src/journeys.ts).
for (let index = 0; index < Number(process.env.E2E_WORKERS ?? 0); index++) {
  const household = createHousehold(db, {
    name: `${seed.syncPair.household} ${index}`,
  });
  for (const member of [seed.syncPair.sam, seed.syncPair.alex]) {
    await createUser(
      db,
      {
        email: `${member.emailPrefix}-${index}@example.com`,
        name: member.name,
        household,
      },
      async () => member.password,
    );
  }
}
// One single-member household per Playwright worker that no test writes to (see emptyStatePersona in src/journeys.ts).
for (let index = 0; index < Number(process.env.E2E_WORKERS ?? 0); index++) {
  await createUser(
    db,
    {
      email: `${seed.emptyState.emailPrefix}-${index}@example.com`,
      name: seed.emptyState.name,
      household: createHousehold(db, {
        name: `${seed.emptyState.household} ${index}`,
      }),
    },
    async () => seed.emptyState.password,
  );
}
const now = Date.now();
seed.suggestions.forEach((name, index) => {
  db.insert(itemSuggestion)
    .values({
      householdId: householdIds.a,
      nameKey: name.toLowerCase(),
      name,
      useCount: 1,
      lastUsedAt: now - index,
    })
    .run();
});
// `sqlite` stays open for the control server below; it shares this process (and thread) with the API's own handle.

const url = new URL(origin);
const server = startServer({
  DB_PATH: dbPath,
  STATIC_DIR: frontendDist,
  PUBLIC_ORIGIN: origin,
  PORT: url.port,
  HOST: url.hostname,
  BETTER_AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
});

// Test-only control endpoint (loopback, token-protected, one route). It applies what the API's hourly
// pruning does to one item, inside this process so the write runs synchronously between API requests
// instead of from a second process contending for the SQLite writer lock.
const controlPort = process.env.E2E_CONTROL_PORT;
const controlToken = process.env.E2E_CONTROL_TOKEN;
const CONTROL_HOST = '127.0.0.1';
const CONTROL_BODY_LIMIT = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const raiseWatermark = sqlite.prepare(
  'UPDATE list_item SET pruned_through_item_revision = max(pruned_through_item_revision, item_revision) WHERE id = ?',
);
const deleteJournal = sqlite.prepare(
  'DELETE FROM item_change WHERE item_id = ?',
);
const expireItemHistory = sqlite.transaction((itemId) => {
  if (raiseWatermark.run(itemId).changes !== 1) return false;
  deleteJournal.run(itemId);
  return true;
});

function tokenMatches(header) {
  const given = Buffer.from(typeof header === 'string' ? header : '');
  const expected = Buffer.from(controlToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function reply(res, status, body = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    connection: 'close',
  });
  res.end(JSON.stringify(body));
}

function handleControl(req, res) {
  if (req.headers.host !== `${CONTROL_HOST}:${controlPort}`) {
    return reply(res, 403);
  }
  if (!tokenMatches(req.headers['x-e2e-control-token'])) {
    return reply(res, 403);
  }
  if (req.url !== '/expire-item-history') return reply(res, 404);
  if (req.method !== 'POST') return reply(res, 405);
  if (!String(req.headers['content-type']).startsWith('application/json')) {
    return reply(res, 415);
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  // After the cap, keep reading (and discarding) so the 413 flushes; `connection: close` ends the socket afterwards.
  req.on('data', (chunk) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > CONTROL_BODY_LIMIT) {
      tooLarge = true;
      chunks.length = 0;
      reply(res, 413);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) return;
    let itemId;
    try {
      itemId = JSON.parse(Buffer.concat(chunks).toString('utf8')).itemId;
    } catch {
      return reply(res, 400);
    }
    if (typeof itemId !== 'string' || !UUID.test(itemId)) {
      return reply(res, 400);
    }
    try {
      reply(res, expireItemHistory(itemId) ? 200 : 404);
    } catch (error) {
      console.error('E2E control: expiring item history failed:', error);
      reply(res, 500);
    }
  });
}

let controlServer;
if (controlPort && controlToken) {
  controlServer = http.createServer(handleControl);
  controlServer.maxHeadersCount = 20;
  controlServer.listen(Number(controlPort), CONTROL_HOST);
}

// Open SSE/keep-alive connections would hold close() forever, so they are cut once close begins.
function closeServer(target) {
  return new Promise((resolve) => {
    target.close(() => resolve());
    target.closeAllConnections();
  });
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  let exitCode = 0;
  try {
    await Promise.all([
      closeServer(server),
      controlServer ? closeServer(controlServer) : undefined,
    ]);
    sqlite.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    else removeDatabaseFiles();
  } catch (error) {
    console.error('E2E server shutdown failed:', error);
    exitCode = 1;
  }
  process.exit(exitCode);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`E2E server listening on ${origin}`);
