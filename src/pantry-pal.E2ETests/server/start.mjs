// Starts the real API on a temporary SQLite database with seeded personas, serving the built frontend.
// Requires `npm run build` first: it imports the compiled API and serves the frontend's `dist`.
import fs from 'node:fs';
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
sqlite.close();

const url = new URL(origin);
const server = startServer({
  DB_PATH: dbPath,
  STATIC_DIR: frontendDist,
  PUBLIC_ORIGIN: origin,
  PORT: url.port,
  HOST: url.hostname,
  BETTER_AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
});

function shutdown() {
  server.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  else removeDatabaseFiles();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`E2E server listening on ${origin}`);
