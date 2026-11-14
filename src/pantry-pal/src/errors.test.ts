import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { CodedHttpException, handleError } from './errors.js';

function buildApp(): Hono {
  const app = new Hono();
  app.get('/coded', () => {
    throw new CodedHttpException(409, 'item_on_other_list');
  });
  app.get('/plain', () => {
    throw new HTTPException(409);
  });
  app.onError(handleError);
  return app;
}

describe('409 error mapping', () => {
  it('maps a coded 409 to item_on_other_list', async () => {
    const res = await buildApp().request('/coded');
    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      '{"error":{"code":"item_on_other_list","message":"Item is on another list."}}',
    );
  });

  it('keeps name_taken for a 409 without a code', async () => {
    const res = await buildApp().request('/plain');
    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      '{"error":{"code":"name_taken","message":"Name is already in use."}}',
    );
  });
});
