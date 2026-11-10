/** Trims and collapses every run of whitespace to one space. Case and accents are kept. */
export function displayName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Normalized comparison key: Unicode NFC, trimmed, collapsed, lowercased. */
export function nameKey(name: string): string {
  return displayName(name.normalize('NFC')).toLowerCase();
}
