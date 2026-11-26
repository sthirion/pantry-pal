/**
 * Applies what the server's hourly pruning task does to an item once its journal entries are 25 hours
 * old: deletes them and raises the item's pruning watermark to its current revision. Pruning only
 * runs on a schedule and there is no endpoint for it, so the spec asks the E2E server's loopback
 * control endpoint (`server/start.mjs`) to do it inside the server process, serialized with API writes.
 */
export async function expireItemHistory(itemId: string): Promise<void> {
  const port = process.env.E2E_CONTROL_PORT;
  const token = process.env.E2E_CONTROL_TOKEN;
  if (!port || !token) {
    throw new Error(
      'E2E_CONTROL_PORT/E2E_CONTROL_TOKEN are not set; run the specs with Playwright.',
    );
  }
  const response = await fetch(`http://127.0.0.1:${port}/expire-item-history`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-e2e-control-token': token,
    },
    body: JSON.stringify({ itemId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Expiring history of item ${itemId} failed with status ${response.status}.`,
    );
  }
}
