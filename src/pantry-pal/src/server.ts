import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, openSqlite, runMigrations } from './db/database.js';
import {
  MaintenanceService,
  startJournalPruneScheduler,
  startMaintenanceScheduler,
} from './services/maintenance-service.js';

/** Loads config, opens and migrates the database, then listens. Throws before listening on any failure. */
export function startServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const db = createDatabase(openSqlite(config.dbPath));
  runMigrations(db);
  const app = createApp({ config, db });
  const maintenance = new MaintenanceService(db);
  const stopMaintenance = startMaintenanceScheduler(maintenance);
  const stopJournalPruning = startJournalPruneScheduler(maintenance);
  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });
  server.on('close', () => {
    stopMaintenance();
    stopJournalPruning();
  });
  return server;
}
