// Coverage of the changed lines (diff coverage). Collection covers the whole run; filtering to the
// changed code happens here, at report time, so no collector needs per-file or per-method filters.

/** @param {Map<string, Map<number, number>>} report file -> (line -> hits), instrumentable lines only
 *  @param {Map<string, Set<number>>} changedLines file -> changed line numbers (source files only)
 *  @returns {{ files: {file:string, covered:number, total:number}[], covered:number, total:number }}
 *  A file contributes only the changed lines the report knows about (non-instrumentable lines such
 *  as braces or comments are ignored), and only if at least one such line exists. */
export function diffCoverage(report, changedLines) {
  const files = [];
  let covered = 0;
  let total = 0;
  for (const [file, lines] of changedLines) {
    const hits = report.get(file);
    if (!hits) continue;
    let c = 0;
    let t = 0;
    for (const n of lines) {
      if (!hits.has(n)) continue;
      t += 1;
      if (hits.get(n) > 0) c += 1;
    }
    if (t > 0) { files.push({ file, covered: c, total: t }); covered += c; total += t; }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { files, covered, total };
}

export function pct(covered, total) {
  return total === 0 ? '0.0%' : `${((covered / total) * 100).toFixed(1)}%`;
}

/** One-line summary: per file `name pct (covered/total)`; never presented as whole-suite coverage. */
export function renderCoverage(result, { reason } = {}) {
  if (reason) return `COVERAGE not measured (${reason})`;
  if (result.total === 0) return 'COVERAGE no instrumentable changed lines in source files';
  const parts = result.files.map((f) => `${f.file.split('/').pop()} ${pct(f.covered, f.total)} (${f.covered}/${f.total})`);
  return `COVERAGE changed lines (sanity signal): ${parts.join(', ')}`;
}
