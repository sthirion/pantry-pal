// Tiny argv helper (design doc §4.1): wraps node:util parseArgs with sensible defaults for
// the tracker.mjs/scm.mjs command style (`<command> [positionals] --flag value`) and turns
// its thrown errors into UsageError so dispatchers can map them to exit code 2.
import { parseArgs as nodeParseArgs } from 'node:util';

export class UsageError extends Error {}

/** Parses `argv` (already past the command name) against an options spec compatible with
 * node:util parseArgs' `options`. Always allows positionals; always strict (unknown flags
 * throw UsageError). */
export function parseArgs(argv, optionsSpec = {}) {
  try {
    return nodeParseArgs({ args: argv, options: optionsSpec, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err.message);
  }
}

/** Validates and returns a positive integer id from a positional string. Every tracker/SCM
 * id must pass through this before being used in a URL or request body (§11 security). */
export function requirePositiveIntId(value, label = 'id') {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) {
    throw new UsageError(`${label} must be a positive integer, got: ${value}`);
  }
  return Number(value);
}
