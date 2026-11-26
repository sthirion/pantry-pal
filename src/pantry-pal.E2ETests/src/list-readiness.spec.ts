import {
  crossOffButton,
  expect,
  pat,
  seedItems,
  startWithList,
  test,
} from './journeys.js';

const ITEM_COUNT = 200;
const READY_BUDGET_MS = 1_000;
const CPU_THROTTLE_RATE = 4;
// Only bounds how long the harness waits for the page to report; the 1000 ms budget is asserted on the reported times.
const REPORT_TIMEOUT_MS = 15_000;

type ReadinessSignal =
  | 'list heading visible'
  | 'add-item input enabled'
  | 'item-action button enabled';

interface ReadinessWindow {
  __listReadiness?: Partial<Record<ReadinessSignal, number>>;
}

/**
 * Runs in the page before its scripts. Stamps each signal with `performance.now()` (milliseconds since
 * this navigation started) on the first rendered frame in which the signal's element is visible and enabled.
 */
function observeReadiness(target: { listName: string; itemName: string }) {
  const marks: Partial<Record<ReadinessSignal, number>> = {};
  (window as unknown as ReadinessWindow).__listReadiness = marks;

  const usable = (element: Element | null): boolean =>
    element !== null &&
    element.checkVisibility() &&
    !(element as HTMLButtonElement | HTMLInputElement).disabled;
  const signals: Array<[ReadinessSignal, () => boolean]> = [
    [
      'list heading visible',
      () => {
        const heading = Array.from(document.querySelectorAll('h1')).find(
          (h1) => h1.textContent === target.listName,
        );
        return usable(heading ?? null);
      },
    ],
    [
      'add-item input enabled',
      () => usable(document.querySelector('input[role="combobox"]')),
    ],
    [
      'item-action button enabled',
      () =>
        usable(
          Array.from(document.querySelectorAll('button')).find(
            (button) =>
              button.getAttribute('aria-label') ===
              `Actions for ${target.itemName}`,
          ) ?? null,
        ),
    ],
  ];

  let frameRequested = false;
  const check = () => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        frameRequested = false;
        const now = performance.now();
        for (const [signal, isReady] of signals) {
          if (marks[signal] === undefined && isReady()) marks[signal] = now;
        }
        if (Object.keys(marks).length === signals.length) observer.disconnect();
      });
    });
  };
  const observer = new MutationObserver(check);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  check();
}

// Tracing records snapshots and a screencast of the page, which would add to the time being measured.
test.use({ trace: 'off' });

test.describe('List readiness @TEST', () => {
  test('a 200-item list is usable within 1 second at 4x CPU throttling', async ({
    page,
    browserName,
  }) => {
    // CPU throttling is a Chromium DevTools feature.
    test.skip(browserName !== 'chromium', 'CPU throttling is Chromium-only');

    // Given
    const listName = await startWithList(page, pat, 'Speed');
    const itemNames = Array.from(
      { length: ITEM_COUNT },
      (_, index) => `item-${String(index + 1).padStart(3, '0')}`,
    );
    await seedItems(
      page,
      itemNames.map((name) => ({ name })),
    );
    // Wait until the whole list is on the device, so the measured visit opens a ready list.
    for (const name of [itemNames[0]!, itemNames.at(-1)!]) {
      await expect(crossOffButton(page, name)).toBeAttached();
    }
    const listUrl = page.url();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: CPU_THROTTLE_RATE,
    });

    await page.addInitScript(observeReadiness, {
      listName,
      itemName: itemNames[0]!,
    });
    const signals: ReadinessSignal[] = [
      'list heading visible',
      'add-item input enabled',
      'item-action button enabled',
    ];

    // When
    await page.goto(listUrl, { waitUntil: 'commit' });
    await page
      .waitForFunction(
        (count) =>
          Object.keys(
            (window as unknown as ReadinessWindow).__listReadiness ?? {},
          ).length === count,
        signals.length,
        { timeout: REPORT_TIMEOUT_MS, polling: 250 },
      )
      .catch(() => undefined);
    const marks = await page.evaluate(
      () => (window as unknown as ReadinessWindow).__listReadiness ?? {},
    );

    // Then
    const missed = signals
      .filter((signal) => !((marks[signal] ?? Infinity) <= READY_BUDGET_MS))
      .map(
        (signal) =>
          `${signal} (${marks[signal] === undefined ? 'never ready' : `${Math.round(marks[signal])} ms`})`,
      );
    expect(
      missed,
      `signals not ready within ${READY_BUDGET_MS} ms of navigation start`,
    ).toEqual([]);
  });
});
