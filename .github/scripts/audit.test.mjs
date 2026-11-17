import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateAudit, run } from './audit.mjs';

const ACTIVE = new Date('2026-11-17T18:00:00Z');
const EXPIRY = new Date('2026-12-17T00:00:00Z');
const ADVISORY = {
  name: 'picomatch',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity: 'high',
};

function updateCounts(report) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    counts[vulnerability.severity]++;
    counts.total++;
  }
  report.metadata = { vulnerabilities: counts };
}

function fixture() {
  const dependencies = {
    '@vitest/coverage-v8': ['vitest'],
    fdir: ['picomatch'],
    picomatch: [{ ...ADVISORY }],
    tinyglobby: ['fdir', 'picomatch'],
    vite: ['picomatch', 'tinyglobby'],
    vitest: ['@vitest/coverage-v8', 'picomatch', 'tinyglobby', 'vite'],
  };
  const nodes = {
    '@vitest/coverage-v8': [['node_modules/@vitest/coverage-v8', '5.1.0']],
    fdir: [['node_modules/tinyglobby/node_modules/fdir', '6.5.0']],
    picomatch: [
      ['node_modules/tinyglobby/node_modules/picomatch', '4.0.7'],
      ['node_modules/vite/node_modules/picomatch', '4.0.7'],
      ['node_modules/vitest/node_modules/picomatch', '4.0.7'],
    ],
    tinyglobby: [['node_modules/tinyglobby', '0.2.17']],
    vite: [['node_modules/vite', '8.3.7']],
    vitest: [['node_modules/vitest', '5.1.0']],
  };
  const report = { auditReportVersion: 2, vulnerabilities: {} };
  const lock = { packages: {} };
  for (const [name, via] of Object.entries(dependencies)) {
    report.vulnerabilities[name] = {
      name,
      severity: 'high',
      nodes: nodes[name].map(([node]) => node),
      via,
    };
    for (const [node, version] of nodes[name]) {
      lock.packages[node] = { version, devOptional: true };
    }
  }
  updateCounts(report);
  return { report, lock };
}

afterEach(() => vi.restoreAllMocks());

describe('dependency audit gate', () => {
  it('accepts only the reviewed advisory and its cyclic tooling dependents', () => {
    const { report, lock } = fixture();

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result).toEqual({
      excepted: Object.keys(report.vulnerabilities),
      blocked: [],
    });
  });

  it('blocks another advisory even in the reviewed picomatch paths', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.picomatch.via.push({
      ...ADVISORY,
      url: 'https://github.com/advisories/GHSA-other',
    });

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result.blocked).toEqual(Object.keys(report.vulnerabilities));
  });

  it.each(['high', 'critical'])(
    'blocks an unrelated %s finding while preserving the narrow exception',
    (severity) => {
      const { report, lock } = fixture();
      report.vulnerabilities.production = {
        name: 'production',
        severity,
        nodes: ['node_modules/production'],
        via: [{ ...ADVISORY, name: 'production', severity }],
      };
      updateCounts(report);

      const result = evaluateAudit(report, lock, ACTIVE);

      expect(result.blocked).toEqual(['production']);
    },
  );

  it('blocks the advisory if a new picomatch path appears', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.picomatch.nodes.push('node_modules/picomatch');
    lock.packages['node_modules/picomatch'] = {
      version: '4.0.7',
      devOptional: true,
    };

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result.blocked).toEqual(Object.keys(report.vulnerabilities));
  });

  it('blocks the advisory if a reviewed dependency becomes a production dependency', () => {
    const { report, lock } = fixture();
    delete lock.packages['node_modules/vitest/node_modules/picomatch'].devOptional;

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result.blocked).toEqual(Object.keys(report.vulnerabilities));
  });

  it('requires review when a locked tooling version changes', () => {
    const { report, lock } = fixture();
    lock.packages['node_modules/vitest/node_modules/picomatch'].version = '4.0.8';

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result.blocked).toEqual(Object.keys(report.vulnerabilities));
  });

  it('blocks excepted findings at the exact expiry boundary', () => {
    const { report, lock } = fixture();

    const result = evaluateAudit(report, lock, EXPIRY);

    expect(result).toEqual({
      excepted: [],
      blocked: Object.keys(report.vulnerabilities),
    });
  });

  it('does not accept an unresolvable meta-vulnerability chain', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.picomatch.via = ['missing'];

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result.blocked).toEqual(Object.keys(report.vulnerabilities));
  });

  it('does not treat a cycle without the actual advisory as an exception', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.picomatch.via = ['vitest'];

    const result = evaluateAudit(report, lock, ACTIVE);

    expect(result.blocked).toEqual(Object.keys(report.vulnerabilities));
  });

  it('keeps the existing high threshold for moderate findings after expiry', () => {
    const { report, lock } = fixture();
    for (const vulnerability of Object.values(report.vulnerabilities)) {
      vulnerability.severity = 'moderate';
    }
    updateCounts(report);

    const result = evaluateAudit(report, lock, EXPIRY);

    expect(result).toEqual({ blocked: [], excepted: [] });
  });

  it.each([
    (report) => delete report.vulnerabilities,
    (report) => (report.error = { code: 'ENOAUDIT' }),
    (report) => (report.metadata.vulnerabilities.high = 0),
    (report) => (report.vulnerabilities.picomatch.nodes = []),
    (report) => (report.vulnerabilities.picomatch.via = [null]),
  ])('fails closed on malformed or error reports (%#)', (corrupt) => {
    const { report, lock } = fixture();
    corrupt(report);

    const evaluate = () => evaluateAudit(report, lock, ACTIVE);

    expect(evaluate).toThrow();
  });

  it.each([
    null,
    { code: 2, stdout: '', stderr: 'Registry unavailable', timedOut: false },
    { code: 1, stdout: '', stderr: 'Timed out', timedOut: true },
    { code: 0, stdout: 'not JSON', stderr: '', timedOut: false },
    {
      code: 1,
      stdout: '{"error":{"code":"ENOAUDIT"}}',
      stderr: '',
      timedOut: false,
    },
  ])('fails closed when npm cannot produce a valid audit (%#)', async (result) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exec = vi.fn().mockResolvedValue(result);

    const execution = run({ exec });

    await expect(execution).rejects.toThrow();
  });
});
