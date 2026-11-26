import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'global.css'), 'utf8');

const ruleFor = (selector: string): string =>
  css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('sync status summary layout', () => {
  it('reserves one line while empty instead of collapsing', () => {
    expect(css).not.toContain('.sync-status__summary:empty');
    expect(ruleFor('\\.sync-status__summary')).toMatch(/min-height:\s*1\.5em/);
    expect(ruleFor('\\.sync-status__summary')).not.toMatch(/display:\s*none/);
  });
});
