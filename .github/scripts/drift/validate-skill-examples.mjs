#!/usr/bin/env node
// Validates that skill code examples reference symbols, paths, and packages that
// still exist in the codebase, and cross-references the pattern registry to flag
// skills teaching Deprecated or Removed patterns and libraries.
// Config: .github/scripts/drift/drift.config.json
// Usage:
//   node validate-skill-examples.mjs                 validate all configured skills
//   node validate-skill-examples.mjs --skill <name>  validate one skill
// Exit code = number of stale references + registry warnings.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadConfig, walkFiles, collectLibraries, readTable, PATTERN_COLUMNS, LIBRARY_COLUMNS, registryPath, repoRoot,
} from './drift-lib.mjs';

const config = loadConfig();
const argv = process.argv.slice(2);
const skillIdx = argv.indexOf('--skill');
const onlySkill = skillIdx !== -1 ? argv[skillIdx + 1] : null;

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const files = walkFiles(config.roots, config.excludeDirs);

// --- Declared packages (all supported manifests) ---
const packages = new Set();
for (const lib of collectLibraries(files).values()) {
  packages.add(lib.name);
  if (lib.ecosystem === 'maven') packages.add(lib.name.split(':')[1]);
}

// --- Find declarations of the types skills reference ---
const allTypes = new Set(Object.values(config.skillSymbols).flatMap((defs) => defs.types ?? []));
const foundTypes = new Set();
if (allTypes.size > 0) {
  const declKinds = 'class|record|interface|enum|struct|type|const|function|object|trait';
  for (const f of files) {
    if (!/\.(cs|java|kt|scala|ts|tsx|js|jsx|mjs|astro|py|go|rs)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const t of allTypes) {
      if (!foundTypes.has(t) && new RegExp(`(?:${declKinds})\\s+${t}\\b`).test(text)) foundTypes.add(t);
    }
  }
}

// --- Registry statuses and the skills that teach each entry ---
const retired = new Set(['Deprecated', 'Removed']);
const registryEntries = [];
if (existsSync(registryPath)) {
  const content = readFileSync(registryPath, 'utf8');
  const skillsFromConfig = new Map(config.patterns.map((p) => [p.name, p.skills ?? []]));
  for (const row of readTable(content, 'patterns', PATTERN_COLUMNS)) {
    const listed = [...row.Skills.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const skills = [...new Set([...(skillsFromConfig.get(row.Pattern) ?? []), ...listed])];
    registryEntries.push({ kind: 'pattern', name: row.Pattern, status: row.Status, skills });
  }
  for (const row of readTable(content, 'libraries', LIBRARY_COLUMNS)) {
    const skills = Object.entries(config.skillSymbols)
      .filter(([, defs]) => (defs.packages ?? []).includes(row.Library))
      .map(([skill]) => skill);
    registryEntries.push({ kind: 'library', name: row.Library, status: row.Status, skills });
  }
}

// --- Validate each skill ---
const skills = onlySkill ? [onlySkill] : Object.keys(config.skillSymbols).sort();
const results = {};
let totalIssues = 0;

for (const name of skills) {
  const defs = config.skillSymbols[name];
  if (!defs) {
    console.log(c.yellow(`No symbol definitions for skill '${name}' — skipping`));
    continue;
  }
  const issues = [];
  for (const t of defs.types ?? []) if (!foundTypes.has(t)) issues.push({ check: 'Type', ref: t });
  for (const p of defs.paths ?? []) if (!existsSync(join(repoRoot, p))) issues.push({ check: 'Path', ref: p });
  for (const pkg of defs.packages ?? []) if (!packages.has(pkg)) issues.push({ check: 'Package', ref: pkg });
  results[name] = issues;
  totalIssues += issues.length;
}

const registryWarnings = registryEntries
  .filter((e) => retired.has(e.status))
  .flatMap((e) => e.skills.filter((s) => !onlySkill || s === onlySkill).map((skill) => ({ skill, ...e })));

// --- Output ---
console.log(c.cyan('\n=== Skill Example Validation Report ==='));
console.log(`Date: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
console.log(`Skills checked: ${Object.keys(results).length}\n`);

for (const name of Object.keys(results).sort()) {
  const issues = results[name];
  if (issues.length === 0) {
    console.log(`  ${c.green(name)} — all references valid`);
  } else {
    console.log(`  ${c.red(name)} — ${issues.length} issue(s):`);
    for (const i of issues) console.log(c.yellow(`    [${i.check}] ${i.ref} — NOT FOUND`));
  }
}

if (registryWarnings.length > 0) {
  console.log(c.yellow('\n=== Registry Cross-Reference Warnings ==='));
  console.log(c.yellow('Skills referencing Deprecated or Removed patterns/libraries:'));
  for (const w of registryWarnings) console.log(c.yellow(`  ${w.skill}: ${w.kind} '${w.name}' is ${w.status}`));
}

console.log('');
if (totalIssues === 0 && registryWarnings.length === 0) {
  console.log(c.green('Result: ALL CHECKS PASSED'));
} else {
  console.log(c.red(`Result: ${totalIssues} stale reference(s), ${registryWarnings.length} registry warning(s)`));
}
process.exit(totalIssues + registryWarnings.length);
