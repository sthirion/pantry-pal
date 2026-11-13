export type VersionListener = (version: number) => void;

/** In-memory fan-out of committed write versions to the subscribers of one household. */
export class HouseholdEventHub {
  private readonly listeners = new Map<string, Set<VersionListener>>();

  /** Returns a function that removes the subscription. */
  subscribe(householdId: string, listener: VersionListener): () => void {
    let household = this.listeners.get(householdId);
    if (!household) {
      household = new Set();
      this.listeners.set(householdId, household);
    }
    household.add(listener);
    return () => {
      household.delete(listener);
      if (household.size === 0) this.listeners.delete(householdId);
    };
  }

  publish(householdId: string, version: number): void {
    for (const listener of [...(this.listeners.get(householdId) ?? [])]) {
      try {
        listener(version);
      } catch {
        // The write is already committed; one failing subscriber must not affect the others or the response.
      }
    }
  }
}
