#!/usr/bin/env node
// Manages model assignments between model-config.json and .agent.md frontmatter.
// Usage:
//   node set-agent-models.mjs                 list current model in each agent file
//   node set-agent-models.mjs --set           apply models from model-config.json
//   node set-agent-models.mjs --set --dry-run preview changes without writing
//   node set-agent-models.mjs --strict        exit 1 if the config is invalid (unknown model keys or
//                                             tiers) or the agent files drift from it: an agent whose
//                                             model differs from its tier (drift), an agent file with
//                                             no config entry (orphan), or a config entry with no
//                                             agent file or no `model:` line (missing)
//   node set-agent-models.mjs --set --strict  validate the config first; write nothing if it is invalid
//
// Optional `availableModels` in model-config.json lists the approvedModels keys the host offers;
// with it, validation also requires the first key of every tier to be listed (the Copilot SDK/CLI
// host never falls back to a later entry).
//
// An agent names its tier with `tier` (or the older `primary`). A tier is one model key or an
// ordered list of keys (first = preferred); keys resolve through `approvedModels`. Frontmatter can
// hold a scalar, an inline array (`model: ['A', 'B']`) or a block list; the script writes a block
// list for more than one model.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(__dirname, '..', '..', 'agents');
const configPath = join(agentsDir, 'model-config.json');

const args = new Set(process.argv.slice(2));
const doSet = args.has('--set');
const strict = args.has('--strict');
const dryRun = args.has('--dry-run');

const c = {
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const unquote = (text) => text.trim().replace(/^(['"])(.*)\1$/, '$2').trim();

function readModel(content) {
  const fm = content.match(FRONTMATTER);
  if (!fm) return null;
  const lines = fm[1].split(/\r?\n/);
  const modelLineIndex = lines.findIndex((line) => /^model:\s*/.test(line));
  if (modelLineIndex < 0) return null;
  const modelValue = lines[modelLineIndex].replace(/^model:\s*/, '').trim();
  if (modelValue.startsWith('[') && modelValue.endsWith(']')) {
    const inline = modelValue.slice(1, -1).split(',').map(unquote).filter(Boolean);
    return inline.length > 0 ? inline : null;
  }
  if (modelValue) return unquote(modelValue);

  const models = [];
  for (const line of lines.slice(modelLineIndex + 1)) {
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!item) break;
    models.push(unquote(item[1]));
  }
  return models.length > 0 ? models : null;
}

function displayModel(model) {
  return Array.isArray(model) ? model.join(' → ') : model;
}

const toList = (model) => (Array.isArray(model) ? model : [model]);
// A scalar and a one-element list mean the same thing, so only the models and their order matter.
const sameModels = (a, b) => JSON.stringify(toList(a)) === JSON.stringify(toList(b));
const agentTier = (agent) => agent.tier ?? agent.primary;

function serializeModel(model, lineEnding) {
  return Array.isArray(model)
    ? `model:${lineEnding}${model.map((item) => `  - ${item}`).join(lineEnding)}`
    : `model: ${model}`;
}

function agentFiles() {
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith('.agent.md'))
    .sort();
}

// --- Default: list current model per agent ---
if (!doSet && !strict) {
  for (const file of agentFiles()) {
    const content = readFileSync(join(agentsDir, file), 'utf8');
    const model = readModel(content) ?? '(no model found)';
    const name = file.replace(/\.agent\.md$/, '');
    console.log(`${name.padEnd(25)} ${displayModel(model)}`);
  }
  process.exit(0);
}

// --- Load config ---
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const tiers = config.tiers ?? {};
const approvedModels = config.approvedModels;
const agents = config.agents ?? [];

// --- Validation phase ---
const warnings = [];
if (
  !approvedModels
  || typeof approvedModels !== 'object'
  || Array.isArray(approvedModels)
  || Object.keys(approvedModels).length === 0
  || Object.entries(approvedModels).some(([key, name]) => !key || typeof name !== 'string' || !name.trim())
) {
  console.log(c.red('[ERROR] approvedModels must be a non-empty object mapping model keys to non-empty model names.'));
  process.exit(1);
}
const resolvedTiers = new Map();
for (const [tierKey, configuredModel] of Object.entries(tiers)) {
  const models = Array.isArray(configuredModel) ? configuredModel : [configuredModel];
  if (models.length === 0 || models.some((model) => typeof model !== 'string' || !model.trim())) {
    warnings.push(`[ERROR] Tier '${tierKey}' must contain one or more approved model keys.`);
    continue;
  }
  const unknown = models.filter((model) => !Object.hasOwn(approvedModels, model));
  if (unknown.length > 0) {
    warnings.push(`[ERROR] Tier '${tierKey}': model keys ${unknown.join(', ')} are not in approvedModels.`);
    continue;
  }
  resolvedTiers.set(tierKey, Array.isArray(configuredModel)
    ? models.map((model) => approvedModels[model])
    : approvedModels[configuredModel]);
}
for (const agent of agents) {
  if (!Object.hasOwn(tiers, agentTier(agent))) {
    warnings.push(`[ERROR] Agent '${agent.name}': tier '${agentTier(agent)}' is not defined in 'tiers'.`);
  }
}

// The Copilot SDK/CLI host uses only the first model and never falls back, so that one must be offered.
if (config.availableModels !== undefined) {
  const available = config.availableModels;
  if (!Array.isArray(available) || available.some((key) => typeof key !== 'string' || !key.trim())) {
    warnings.push('[ERROR] availableModels must be an array of approvedModels keys.');
  } else {
    const unknownAvailable = available.filter((key) => !Object.hasOwn(approvedModels, key));
    if (unknownAvailable.length > 0) {
      warnings.push(`[ERROR] availableModels: model keys ${unknownAvailable.join(', ')} are not in approvedModels.`);
    }
    for (const [tierKey, configuredModel] of Object.entries(tiers)) {
      const first = Array.isArray(configuredModel) ? configuredModel[0] : configuredModel;
      if (typeof first === 'string' && first.trim() && !available.includes(first)) {
        warnings.push(`[ERROR] Tier '${tierKey}': first model key '${first}' is not in availableModels (${available.join(', ')}).`);
      }
    }
  }
}

if (strict && warnings.length > 0) {
  for (const w of warnings) console.log(c.red(w));
  console.log(c.red('\nValidation failed. No files were modified.'));
  process.exit(1);
}
for (const w of warnings) console.log(c.yellow(w));

// --- Check phase (--strict without --set): the agent files must match the config ---
if (!doSet) {
  const problems = [];
  for (const agent of agents) {
    const file = join(agentsDir, `${agent.name}.agent.md`);
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      problems.push(`[MISSING] Agent '${agent.name}' is in model-config.json but ${agent.name}.agent.md does not exist.`);
      continue;
    }
    const current = readModel(content);
    if (!current) {
      problems.push(`[MISSING] ${agent.name}.agent.md has no 'model:' in its frontmatter.`);
      continue;
    }
    const target = resolvedTiers.get(agentTier(agent));
    if (target && !sameModels(current, target)) {
      problems.push(`[DRIFT] ${agent.name}.agent.md: ${displayModel(current)} (file) differs from ${displayModel(target)} (tier '${agentTier(agent)}').`);
    }
  }
  const configured = new Set(agents.map((a) => a.name));
  for (const file of agentFiles()) {
    if (!configured.has(file.replace(/\.agent\.md$/, ''))) problems.push(`[ORPHAN] ${file} has no entry in model-config.json.`);
  }
  for (const problem of problems) console.log(c.red(problem));
  if (problems.length > 0) console.log(c.red('\nAgent files are out of sync with model-config.json. Run with --set to apply it.'));
  else console.log(c.green('Agent files match model-config.json.'));
  process.exit(problems.length > 0 ? 1 : 0);
}

// --- Patch phase ---
const agentNames = agents.map((a) => a.name);
for (const agent of agents) {
  const tierKey = agentTier(agent);
  if (!resolvedTiers.has(tierKey)) {
    console.log(c.yellow(`[WARNING] Agent '${agent.name}': tier '${tierKey}' is missing or invalid — skipping.`));
    continue;
  }
  const targetModel = resolvedTiers.get(tierKey);
  const agentFile = join(agentsDir, `${agent.name}.agent.md`);

  let content;
  try {
    content = readFileSync(agentFile, 'utf8');
  } catch {
    console.log(c.yellow(`[WARNING] No .agent.md found for agent '${agent.name}'`));
    continue;
  }

  const fm = content.match(FRONTMATTER);
  if (!fm) {
    console.log(c.yellow(`[WARNING] ${agent.name}.agent.md: no YAML frontmatter found — skipping.`));
    continue;
  }
  const oldModel = readModel(content);
  if (!oldModel) {
    console.log(c.yellow(`[WARNING] ${agent.name}.agent.md: no 'model:' line in frontmatter — skipping.`));
    continue;
  }
  if (sameModels(oldModel, targetModel)) {
    console.log(c.gray(`[NO CHANGE] ${agent.name}.agent.md`));
    continue;
  }
  const oldModelText = displayModel(oldModel);
  const targetModelText = displayModel(targetModel);
  if (dryRun) {
    console.log(c.cyan(`[DRY RUN] ${agent.name}.agent.md: would set model preference to ${targetModelText}`));
    continue;
  }
  const lineEnding = fm[1].includes('\r\n') ? '\r\n' : '\n';
  const replacement = serializeModel(targetModel, lineEnding);
  const newFrontmatter = fm[1].replace(/^model:[^\r\n]*(?:\r?\n[ \t]+-[ \t]+[^\r\n]*)*/m, replacement);
  const newContent = content.replace(fm[1], newFrontmatter);
  writeFileSync(agentFile, newContent);
  console.log(c.green(`[UPDATED] ${agent.name}.agent.md: ${oldModelText} → ${targetModelText}`));
}

// --- Orphan check ---
for (const file of agentFiles()) {
  const baseName = file.replace(/\.agent\.md$/, '');
  if (!agentNames.includes(baseName)) {
    console.log(c.yellow(`[WARNING] ${file}: no entry in model-config.json`));
  }
}
