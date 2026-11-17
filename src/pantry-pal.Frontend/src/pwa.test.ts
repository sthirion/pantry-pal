import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  purpose?: string;
}

const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name?: string;
  start_url?: string;
  display?: string;
  icons?: ManifestIcon[];
};

describe('PWA installability', () => {
  it('has the manifest fields Chrome requires', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(['standalone', 'fullscreen']).toContain(manifest.display);
  });

  it('declares 192 and 512 icons plus a maskable icon, all present on disk', () => {
    const sizes = manifest.icons?.map((i) => i.sizes) ?? [];
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons?.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons ?? []) {
      expect(existsSync(join(root, 'public', icon.src))).toBe(true);
    }
  });

  it('links the manifest and an iOS home-screen icon from index.html', () => {
    const html = read('index.html');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('apple-mobile-web-app-capable');
  });

  it('scopes the app to the site root and gives it names for the home screen', () => {
    const full = manifest as Record<string, string>;
    expect(full['scope']).toBe('/');
    expect(full['id']).toBe('/');
    expect(full['short_name']).toBeTruthy();
    expect(full['description']).toBeTruthy();
  });

  it('matches the manifest colours to the dark default theme', () => {
    const full = manifest as Record<string, string>;
    const css = read('src/styles/theme.css');
    const bg = /--color-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(full['background_color']).toBe(bg);
    expect(full['theme_color']).toBe(bg);
  });

  it('sets browser theme colours for both device preferences and allows both schemes', () => {
    const html = read('index.html').replace(/\s+/g, ' ');
    expect(html).toContain(
      'content="#121212" media="(prefers-color-scheme: dark)"',
    );
    expect(html).toContain(
      'content="#ffffff" media="(prefers-color-scheme: light)"',
    );
    expect(html).toContain('name="color-scheme" content="dark light"');
    expect(html).toContain('<html lang="en">');
  });

  it('ships a service worker with a fetch handler that never caches the API', () => {
    const sw = read('public/sw.js');
    expect(sw).toContain("addEventListener('fetch'");
    expect(sw).toContain("startsWith('/api/')");
  });
});
