import readline from 'node:readline';
import { parseArgs } from 'node:util';
import {
  CliError,
  createHousehold,
  createUser,
  resetPassword,
  type PasswordPrompt,
} from './admin-commands.js';
import { loadConfig } from './config.js';
import {
  createDatabase,
  openSqlite,
  runMigrations,
  type AppDatabase,
} from './db/database.js';

const USAGE = `Usage: npm run admin -- <command> [options]

Commands:
  household:create --name <name>
  user:create --email <email> --name <name> --household <household-id>
  user:reset-password --email <email>

Passwords are read from a hidden prompt; there is no password option.`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  prompt: PasswordPrompt;
  isInteractive: boolean;
}

function parseOptions(args: string[], names: string[]) {
  const options = Object.fromEntries(
    names.map((n) => [n, { type: 'string' as const }]),
  );
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false })
      .values;
  } catch (error) {
    throw new CliError(
      `${error instanceof Error ? error.message : 'Invalid arguments.'}\n${USAGE}`,
    );
  }
}

/** Runs one admin command; returns the process exit code. */
export async function runCli(
  argv: string[],
  db: AppDatabase,
  io: CliIo,
): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'household:create': {
        const o = parseOptions(rest, ['name']);
        io.out(createHousehold(db, { name: o.name }));
        return 0;
      }
      case 'user:create': {
        const o = parseOptions(rest, ['email', 'name', 'household']);
        requireInteractive(io);
        io.out(await createUser(db, o, io.prompt));
        return 0;
      }
      case 'user:reset-password': {
        const o = parseOptions(rest, ['email']);
        requireInteractive(io);
        await resetPassword(db, o, io.prompt);
        io.out('Password reset; all sessions revoked.');
        return 0;
      }
      default:
        throw new CliError(USAGE);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

function requireInteractive(io: CliIo): void {
  if (!io.isInteractive) {
    throw new CliError('A terminal is required to enter a password.');
  }
}

/** Prompts on the TTY without echoing the typed characters. */
function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const rlWithWrite = rl as unknown as {
      _writeToOutput: (text: string) => void;
    };
    process.stdout.write(label);
    rlWithWrite._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const sqlite = openSqlite(config.dbPath);
  try {
    const db = createDatabase(sqlite);
    runMigrations(db);
    process.exitCode = await runCli(process.argv.slice(2), db, {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
      prompt: hiddenPrompt,
      isInteractive: Boolean(process.stdin.isTTY),
    });
  } finally {
    sqlite.close();
  }
}
