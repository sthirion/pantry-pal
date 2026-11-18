import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runCapture } from './adlc-lib/exec.mjs';

const ROOT = new URL('../../', import.meta.url);
const ADVISORY = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const EXPIRES = new Date('2026-12-17T00:00:00Z');
const TOOLING = new Map([
  ['node_modules/@vitest/coverage-v8', '5.1.0'],
  ['node_modules/vitest', '5.1.0'],
  ['node_modules/vite', '8.3.8'],
  ['node_modules/tinyglobby', '0.2.17'],
  ['node_modules/tinyglobby/node_modules/fdir', '6.5.0'],
  ['node_modules/tinyglobby/node_modules/picomatch', '4.0.7'],
  ['node_modules/vite/node_modules/picomatch', '4.0.7'],
  ['node_modules/vitest/node_modules/picomatch', '4.0.7'],
]);
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export function evaluateAudit(report, lock, now = new Date()) {
  if (
    report?.auditReportVersion !== 2 ||
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities) ||
    !lock?.packages ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error('Invalid npm audit report, lockfile, or evaluation date.');
  }
  const vulnerabilities = report.vulnerabilities;
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (
      vulnerability?.name !== name ||
      !SEVERITIES.includes(vulnerability.severity) ||
      !Array.isArray(vulnerability.nodes) ||
      vulnerability.nodes.length === 0 ||
      !vulnerability.nodes.every((node) => typeof node === 'string') ||
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0 ||
      !vulnerability.via.every(
        (via) =>
          typeof via === 'string' ||
          (via &&
            typeof via === 'object' &&
            typeof via.url === 'string' &&
            SEVERITIES.includes(via.severity)),
      )
    ) {
      throw new Error(`Invalid npm audit vulnerability: ${name}`);
    }
    counts[vulnerability.severity]++;
  }
  if (
    SEVERITIES.some(
      (severity) =>
        report.metadata?.vulnerabilities?.[severity] !== counts[severity],
    ) ||
    report.metadata?.vulnerabilities?.total !==
      Object.keys(vulnerabilities).length
  ) {
    throw new Error('npm audit vulnerability counts do not match the report.');
  }

  function isExcepted(name) {
    if (now >= EXPIRES) return false;
    const pending = [name];
    const visited = new Set();
    let foundAdvisory = false;
    // npm meta-vulnerabilities can contain cycles (Vitest and its coverage peer).
    while (pending.length > 0) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      const vulnerability = vulnerabilities[current];
      if (
        !vulnerability ||
        vulnerability.severity !== 'high' ||
        !vulnerability.nodes.every(
          (node) =>
            TOOLING.has(node) &&
            lock.packages[node]?.version === TOOLING.get(node) &&
            lock.packages[node]?.devOptional === true,
        )
      ) {
        return false;
      }
      for (const via of vulnerability.via) {
        if (typeof via === 'string') {
          pending.push(via);
        } else if (
          current === 'picomatch' &&
          via.name === 'picomatch' &&
          via.url === ADVISORY &&
          via.severity === 'high'
        ) {
          foundAdvisory = true;
        } else {
          return false;
        }
      }
    }
    return foundAdvisory;
  }

  const blocked = [];
  const excepted = [];
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!['high', 'critical'].includes(vulnerability.severity)) continue;
    (isExcepted(name) ? excepted : blocked).push(name);
  }
  return { blocked, excepted };
}

export async function run({ exec = runCapture } = {}) {
  const result = await exec(
    'npm',
    ['audit', '--omit=dev', '--audit-level=high', '--json'],
    { cwd: ROOT },
  );
  if (!result) throw new Error('Could not start npm audit.');
  if (result.stderr) console.error(result.stderr);
  if (result.stdout) console.log(result.stdout);
  if (result.timedOut || ![0, 1].includes(result.code)) {
    throw new Error(`npm audit failed (exit ${result.code}).`);
  }
  const report = JSON.parse(result.stdout);
  const lock = JSON.parse(
    await readFile(new URL('package-lock.json', ROOT), 'utf8'),
  );
  const { blocked, excepted } = evaluateAudit(report, lock);
  if (excepted.length > 0) {
    console.warn(
      `TEMPORARY RISK ACCEPTANCE: ${ADVISORY}; expires ${EXPIRES.toISOString()}; tooling only: ${excepted.join(', ')}. These findings are NOT fixed.`,
    );
  }
  if (blocked.length > 0) {
    console.error(
      `Audit blocked: ${blocked.join(', ')}. Findings are unexcepted, changed scope, or the exception has expired.`,
    );
    return 1;
  }
  console.log('Audit passed: no unexcepted high/critical findings.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error('Audit failed:', error);
      process.exitCode = 1;
    });
}
