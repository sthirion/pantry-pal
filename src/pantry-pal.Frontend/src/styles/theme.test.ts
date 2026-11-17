import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8');

type Tokens = Record<string, string>;

function parseTokens(block: string): Tokens {
  const tokens: Tokens = {};
  for (const [, name, value] of block.matchAll(
    /--([\w-]+):\s*(#[0-9a-f]{6});/gi,
  )) {
    tokens[name] = value;
  }
  return tokens;
}

const lightStart = css.indexOf('@media (prefers-color-scheme: light)');
const dark = parseTokens(css.slice(0, lightStart));
const light = parseTokens(css.slice(lightStart));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio]; 4.5 for text, 3 for UI borders and focus rings.
const PAIRS: ReadonlyArray<[string, string, number]> = [
  ['color-text', 'color-bg', 4.5],
  ['color-text', 'color-surface', 4.5],
  ['color-text-muted', 'color-surface', 4.5],
  ['color-text-muted', 'color-bg', 4.5],
  ['color-on-primary', 'color-primary', 4.5],
  ['color-primary', 'color-surface', 3],
  ['color-error', 'color-surface', 4.5],
  ['color-error', 'color-bg', 4.5],
  ['color-border', 'color-bg', 3],
  ['color-focus', 'color-bg', 3],
  ['color-focus', 'color-surface', 3],
];

describe('theme tokens', () => {
  it('defines dark as the default and light only under the light preference', () => {
    expect(dark['color-bg']).toBe('#121212');
    expect(light['color-bg']).toBe('#ffffff');
    expect(css.slice(0, lightStart)).not.toContain('prefers-color-scheme');
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
  });

  it('defines the same tokens in both themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  describe.each([
    ['dark', dark],
    ['light', light],
  ])('%s theme', (_name, tokens) => {
    it.each(PAIRS)('%s on %s meets %d:1', (fg, bg, min) => {
      expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(min);
    });
  });
});
