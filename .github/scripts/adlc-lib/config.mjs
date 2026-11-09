// tracker.config.json loading + git remote detection (design doc §8.1/§8.2/§8.4). Machine
// values (org, project, labels, ...) live only in tracker.config.json; derivable values
// (owner/repo/host, ADO org/project when the SCM is also ADO) are parsed from the git
// remote here, never duplicated into config.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

export class ConfigError extends Error {}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Exact template defaults from modules/tracker/ado/github/scripts/tracker.config.json (§8.4)
// — checked for exact equality, not a generic "looks like a placeholder" heuristic, since
// "org" is a full URL (`https://dev.azure.com/your-org`) rather than a bare token.
const ADO_PLACEHOLDER_VALUES = {
  org: 'https://dev.azure.com/your-org',
  project: 'your-project',
  team: 'your-team',
  areaPath: 'your-project\\your-area',
};

/** Loads and validates `.github/scripts/tracker/tracker.config.json`. Throws ConfigError (map to
 * exit 2) naming the exact missing/placeholder key. */
export async function loadTrackerConfig(scriptsDir) {
  const configPath = path.join(scriptsDir, 'tracker.config.json');
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const oldPath = path.join(scriptsDir, '..', 'tracker.config.json');
      if (await fileExists(oldPath)) {
        throw new ConfigError(
          `tracker.config.json moved. Found the old file at ${oldPath} but it is now read from ${configPath}. Move it: git mv "${oldPath}" "${configPath}"`
        );
      }
      throw new ConfigError(
        `tracker.config.json not found at ${configPath}. Re-run create-adlc with a tracker module selected, or copy the template and fill it in.`
      );
    }
    throw err;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`tracker.config.json is not valid JSON: ${err.message}`);
  }

  if (!config.tracker) {
    throw new ConfigError('tracker.config.json: "tracker" is required (e.g. "ado" or "github")');
  }
  if (config.tracker === 'ado') {
    for (const [key, placeholder] of Object.entries(ADO_PLACEHOLDER_VALUES)) {
      const value = config[key];
      if (!value || value === placeholder) {
        throw new ConfigError(`tracker.config.json: "${key}" is still the placeholder "${placeholder}"`);
      }
    }
  }
  return config;
}

/** Lenient read of just the `tracker` field from `.github/scripts/tracker/tracker.config.json`, used
 * by scm.mjs to learn which linking form to use in a PR body (§8.3) — a PR shouldn't fail to
 * create just because the tracker isn't (fully) configured. Returns null (not a throw) when
 * the file is missing, isn't valid JSON, or has no "tracker" field. */
export async function detectTrackerType(scriptsDir) {
  try {
    const raw = await readFile(path.join(scriptsDir, 'tracker.config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.tracker || null;
  } catch {
    return null;
  }
}

/** Runs `git remote get-url origin` via the injected exec (adlc-lib/exec.mjs runFixedCommand
 * shape). Returns the raw URL string, or null if there's no such remote (e.g. not a git repo,
 * or no "origin"). */
export async function detectGitRemoteUrl(exec) {
  const result = await exec('git', ['remote', 'get-url', 'origin']);
  return result?.stdout?.trim() || null;
}

/** Parses a GitHub remote URL (https or ssh, github.com/GHE.com/GHES) into { host, owner,
 * repo }, or null if the URL doesn't look like a GitHub remote. */
export function parseGitHubRemote(url) {
  if (!url) return null;
  let match = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match) return { host: match[1], owner: match[2], repo: match[3] };
  match = url.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return { host: match[1], owner: match[2], repo: match[3] };
  return null;
}

/** Maps a GitHub host to its REST/GraphQL API bases (§8.2/D9 — host-agnostic, never
 * hard-code github.com). Covers github.com, *.ghe.com, and GHES (any other host). */
export function apiBaseForHost(host) {
  if (host === 'github.com') return { rest: 'https://api.github.com', graphql: 'https://api.github.com/graphql' };
  const ghe = host.match(/^([^.]+)\.ghe\.com$/);
  if (ghe) return { rest: `https://api.${ghe[1]}.ghe.com`, graphql: `https://api.${ghe[1]}.ghe.com/graphql` };
  return { rest: `https://${host}/api/v3`, graphql: `https://${host}/api/graphql` };
}

/** Parses an Azure DevOps remote URL (dev.azure.com https/ssh, or legacy
 * *.visualstudio.com) into { org, project, repo }, URL-decoding project names with spaces. */
export function parseAdoRemote(url) {
  if (!url) return null;
  let match = url.match(/^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)\/?$/);
  if (match) return decodeAdoParts(match);
  match = url.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)$/);
  if (match) return decodeAdoParts(match);
  match = url.match(/^https?:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)\/?$/);
  if (match) return decodeAdoParts(match);
  return null;
}

function decodeAdoParts(match) {
  return { org: decodeURIComponent(match[1]), project: decodeURIComponent(match[2]), repo: decodeURIComponent(match[3]) };
}
