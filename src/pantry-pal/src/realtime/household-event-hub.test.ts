import { describe, expect, it } from 'vitest';
import { HouseholdEventHub } from './household-event-hub.js';

describe('HouseholdEventHub', () => {
  it('delivers a version to every subscriber of the household', () => {
    const hub = new HouseholdEventHub();
    const first: number[] = [];
    const second: number[] = [];
    hub.subscribe('h1', (v) => first.push(v));
    hub.subscribe('h1', (v) => second.push(v));

    hub.publish('h1', 7);

    expect(first).toEqual([7]);
    expect(second).toEqual([7]);
  });

  it('does not deliver to other households', () => {
    const hub = new HouseholdEventHub();
    const other: number[] = [];
    hub.subscribe('h2', (v) => other.push(v));

    hub.publish('h1', 7);

    expect(other).toEqual([]);
  });

  it('stops delivering after unsubscribe and keeps other subscribers', () => {
    const hub = new HouseholdEventHub();
    const removed: number[] = [];
    const kept: number[] = [];
    const unsubscribe = hub.subscribe('h1', (v) => removed.push(v));
    hub.subscribe('h1', (v) => kept.push(v));

    unsubscribe();
    hub.publish('h1', 1);

    expect(removed).toEqual([]);
    expect(kept).toEqual([1]);
  });

  it('is a no-op to publish with no subscribers or to unsubscribe twice', () => {
    const hub = new HouseholdEventHub();
    expect(() => hub.publish('h1', 1)).not.toThrow();
    const unsubscribe = hub.subscribe('h1', () => undefined);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('keeps delivering to later subscribers when a listener throws', () => {
    const hub = new HouseholdEventHub();
    const received: number[] = [];
    hub.subscribe('h1', () => {
      throw new Error('boom');
    });
    hub.subscribe('h1', (v) => received.push(v));

    expect(() => hub.publish('h1', 4)).not.toThrow();

    expect(received).toEqual([4]);
  });

  it('delivers to a subscriber added again after the last one left', () => {
    const hub = new HouseholdEventHub();
    hub.subscribe('h1', () => undefined)();
    const received: number[] = [];
    hub.subscribe('h1', (v) => received.push(v));

    hub.publish('h1', 3);

    expect(received).toEqual([3]);
  });
});
