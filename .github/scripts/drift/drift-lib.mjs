// Shared helpers for scan-drift.mjs and validate-skill-examples.mjs.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, basename, sep } from 'node:path';
import { matchesAny } from '../adlc-lib/changed-files.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptsDir, '..', '..', '..');
export const configPath = join(scriptsDir, 'drift.config.json');
export const registryPath = join(repoRoot, '.github', 'memorybank', 'patterns', 'registry.md');
export const statePath = join(repoRoot, '.github', 'memorybank', 'patterns', 'drift-state.json');

export const STATUSES = ['Candidate', 'Active', 'Deprecated', 'Removed', 'Ignored'];

// YYYY-MM-DD in UTC, so dates agree across time zones.
export const utcDate = (date = new Date()) => date.toISOString().slice(0, 10);

export function loadConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  return {
    roots: config.roots ?? ['src'],
    excludeDirs: config.excludeDirs ?? [],
    patterns: config.patterns ?? [],
    skillSymbols: config.skillSymbols ?? {},
  };
}

export const toRepoPath = (file) => relative(repoRoot, file).split(sep).join('/');

/** A pattern's optional `paths` limits it to files under those repo-relative globs (`*`, `**`, `?`;
 * a leading `!` excludes), so a detector can target one project or skip a generated folder. A
 * pattern without `paths` scans every file under the config roots. */
export function inPaths(paths, repoPath) {
  return !Array.isArray(paths) || paths.length === 0 || matchesAny(paths, repoPath);
}

export function walkFiles(roots, excludeDirs) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!excludeDirs.includes(entry)) visit(full);
      } else {
        files.push(full);
      }
    }
  };
  for (const root of roots) {
    const dir = join(repoRoot, root);
    if (existsSync(dir)) visit(dir);
  }
  return files;
}

// --- Dependency manifests -------------------------------------------------

function add(libs, ecosystem, name, version, manifest) {
  const key = `${ecosystem}:${name}`;
  const existing = libs.get(key);
  if (!existing) {
    libs.set(key, { ecosystem, name, version: version || '—', manifest });
  } else if (version && !existing.version.split(', ').includes(version)) {
    existing.version = existing.version === '—' ? version : `${existing.version}, ${version}`;
  }
}

const parsers = {
  npm(text, file, libs) {
    const pkg = JSON.parse(text);
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) add(libs, 'npm', name, version, file);
    }
  },
  nuget(text, file, libs) {
    for (const [, attrs] of text.matchAll(/<Package(?:Reference|Version)\b([^>]*)>/g)) {
      const name = attrs.match(/\bInclude="([^"]+)"/)?.[1];
      if (name) add(libs, 'nuget', name, attrs.match(/\bVersion="([^"]*)"/)?.[1], file);
    }
  },
  maven(text, file, libs) {
    const body = text.replace(/<!--[\s\S]*?-->/g, '');
    for (const m of body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const tag = (t) => m[1].match(new RegExp(`<${t}>\\s*([^<\\s]+)\\s*</${t}>`))?.[1];
      const group = tag('groupId');
      const artifact = tag('artifactId');
      if (group && artifact) add(libs, 'maven', `${group}:${artifact}`, tag('version'), file);
    }
  },
  gradle(text, file, libs) {
    const re = /\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt)\s*\(?\s*["']([^:"'\s]+):([^:"'\s]+)(?::([^"'\s]+))?["']/g;
    for (const m of text.matchAll(re)) add(libs, 'maven', `${m[1]}:${m[2]}`, m[3], file);
  },
};

function manifestParser(file) {
  const name = basename(file);
  if (name === 'package.json') return parsers.npm;
  if (name.endsWith('.csproj') || name === 'Directory.Packages.props') return parsers.nuget;
  if (name === 'pom.xml') return parsers.maven;
  if (name === 'build.gradle' || name === 'build.gradle.kts') return parsers.gradle;
  return null;
}

// Returns Map<"ecosystem:name", { ecosystem, name, version, manifest }>.
export function collectLibraries(files) {
  const libs = new Map();
  for (const file of files) {
    const parse = manifestParser(file);
    if (!parse) continue;
    try {
      parse(readFileSync(file, 'utf8'), toRepoPath(file), libs);
    } catch (err) {
      console.warn(`Skipping unreadable manifest ${toRepoPath(file)}: ${err.message}`);
    }
  }
  return libs;
}

export const majorOf = (version) => version.match(/\d+/)?.[0] ?? null;

// --- Registry markdown ----------------------------------------------------

export const PATTERN_COLUMNS = ['Pattern', 'Scope', 'Status', 'Files', 'Occurrences', 'Oldest use', 'Newest use', 'Skills', 'Notes'];
export const LIBRARY_COLUMNS = ['Library', 'Ecosystem', 'Version', 'Status', 'First seen', 'Notes'];

const markers = (section) => [`<!-- drift:${section} -->`, `<!-- /drift:${section} -->`];
const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// Returns the rows of a marked table as objects keyed by column name.
export function readTable(content, section, columns) {
  const [start, end] = markers(section);
  const from = content.indexOf(start);
  const to = content.indexOf(end);
  if (from === -1 || to === -1) return [];
  const lines = content.slice(from + start.length, to).split('\n').filter((l) => l.trim().startsWith('|'));
  return lines.slice(2).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(columns.map((col, i) => [col, cells[i] ?? '']));
  });
}

export function writeTable(content, section, columns, rows) {
  const [start, end] = markers(section);
  const from = content.indexOf(start);
  const to = content.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`Registry is missing the ${start} ... ${end} markers.`);
  const table = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((col) => escapeCell(row[col])).join(' | ')} |`),
  ].join('\n');
  return `${content.slice(0, from + start.length)}\n${table}\n${content.slice(to)}`;
}

// --- Git ------------------------------------------------------------------

export function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Returns an array of author dates (YYYY-MM-DD), one per line of the file, or null if not tracked.
export function blameDates(file) {
  const out = git(['blame', '--line-porcelain', '--', toRepoPath(file)]);
  if (out === null) return null;
  const dates = [];
  let time = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('author-time ')) time = Number(line.slice(12));
    else if (line.startsWith('\t')) dates.push(time ? utcDate(new Date(time * 1000)) : null);
  }
  return dates;
}
