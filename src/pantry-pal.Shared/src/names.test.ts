import { describe, expect, it } from 'vitest';
import { displayName, nameKey } from './names.js';

describe('displayName', () => {
  it.each([
    ['  Ice   Cream ', 'Ice Cream'],
    ['ICE CREAM', 'ICE CREAM'],
    ['Ice\tCream\n', 'Ice Cream'],
    ['Ice\u00A0\u00A0Cream', 'Ice Cream'],
    ['ÄPFEL', 'ÄPFEL'],
    ['牛奶', '牛奶'],
    ['   ', ''],
    ['', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(displayName(input)).toBe(expected);
  });

  it('keeps the decomposed form unchanged', () => {
    expect(displayName('Cafe\u0301')).toBe('Cafe\u0301');
  });
});

describe('nameKey', () => {
  it.each([
    ['  Ice   Cream ', 'ice cream'],
    ['ICE CREAM', 'ice cream'],
    ['Ice\tCream\n', 'ice cream'],
    ['Ice\u00A0\u00A0Cream', 'ice cream'],
    ['ÄPFEL', 'äpfel'],
    ['牛奶', '牛奶'],
    ['   ', ''],
    ['', ''],
  ])('keys %j as %j', (input, expected) => {
    expect(nameKey(input)).toBe(expected);
  });

  it('gives composed and decomposed accents the same NFC key', () => {
    expect(nameKey('Cafe\u0301')).toBe('café');
    expect(nameKey('Cafe\u0301')).toBe(nameKey('Café'));
  });

  it('does not conflate different names or strip accents', () => {
    expect(nameKey('Ice Cream')).not.toBe(nameKey('Ice Creams'));
    expect(nameKey('Café')).not.toBe(nameKey('Cafe'));
  });
});
