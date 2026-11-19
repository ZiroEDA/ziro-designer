// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The GitHub server functions as Cloudflare Pages runs them: `functions/api/github/*.js`, each the
 * Node handler from `api/github/` behind `api/github/_fetch_adapter.js`, called with a Fetch API
 * `Request` and an environment the way a Pages Function is.
 *
 * GitHub is never reached: every case here is answered before the token exchange (a missing
 * secret, code or token, a foreign origin, a wrong method). The exchange itself is
 * github_server_functions.test.ts's, against a fake GitHub. No real secret appears here.
 */
import { describe, expect, it } from 'vitest';

type PagesFunction = (context: {
  request: Request;
  env: Record<string, string | undefined>;
}) => Promise<Response>;
type Make = (env: Record<string, string | undefined>) => (req: never, res: never) => Promise<void>;

const route = async (name: string): Promise<PagesFunction> =>
  (
    (await import(
      /* @vite-ignore */ new URL(`../../../functions/api/github/${name}.js`, import.meta.url).href
    )) as { onRequest: PagesFunction }
  ).onRequest;
const { toPagesFunction } = (await import(
  /* @vite-ignore */ new URL('../../../api/github/_fetch_adapter.js', import.meta.url).href
)) as { toPagesFunction: (make: Make) => PagesFunction };

const callback = await route('callback');
const refresh = await route('refresh');
const revoke = await route('revoke');

const SITE = 'https://designer.ziroeda.com';
const SECRET = { GITHUB_APP_CLIENT_SECRET: 'test-secret-not-real' };
const STATE = 'a'.repeat(43);

describe('the adapter', () => {
  it('hands the handler the method, path and query, lower-case headers and the body as text', async () => {
    let seen: Record<string, unknown> = {};
    const fn = toPagesFunction(() => async (req: never, res: never) => {
      seen = { ...(req as object) };
      const r = res as {
        statusCode: number;
        setHeader(k: string, v: string): void;
        end(b: string): void;
      };
      r.statusCode = 201;
      r.setHeader('X-Test', 'yes');
      r.end('done');
    });
    const answer = await fn({
      request: new Request(`${SITE}/api/x?a=1&b=two`, {
        method: 'POST',
        headers: { Origin: SITE, 'X-Mixed-Case': 'v' },
        body: '{"k":1}',
      }),
      env: {},
    });
    expect(seen).toEqual({
      method: 'POST',
      url: '/api/x?a=1&b=two',
      headers: expect.objectContaining({
        origin: SITE,
        'x-mixed-case': 'v',
        host: 'designer.ziroeda.com',
      }),
      body: '{"k":1}',
    });
    expect(answer.status).toBe(201);
    expect(answer.headers.get('x-test')).toBe('yes');
    expect(await answer.text()).toBe('done');
  });

  it('passes the Pages environment to the handler, not process.env', async () => {
    let got: Record<string, string | undefined> = {};
    const fn = toPagesFunction((env) => {
      got = env;
      return async (_req: never, res: never) => (res as { end(): void }).end();
    });
    await fn({ request: new Request(`${SITE}/api/x`), env: { ONLY_HERE: '1' } });
    expect(got).toEqual({ ONLY_HERE: '1' });
  });

  it('sends no body with a HEAD answer', async () => {
    const answer = await callback({
      request: new Request(`${SITE}/api/github/callback`, { method: 'HEAD' }),
      env: SECRET,
    });
    expect(await answer.text()).toBe('');
  });
});

describe('/api/github/callback on Pages', () => {
  it('refuses a sign-in that did not come from ZiroEDA, with the page and its headers', async () => {
    const answer = await callback({
      request: new Request(`${SITE}/api/github/callback?code=x`),
      env: SECRET,
    });
    expect(answer.status).toBe(400);
    expect(answer.headers.get('content-type')).toMatch(/^text\/html/);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('content-security-policy')).toMatch(
      /^default-src 'none'; script-src 'nonce-/,
    );
    expect(await answer.text()).toMatch(/did not come from ZiroEDA/);
  });

  it('says GitHub is not set up when the Pages project has no secret', async () => {
    const answer = await callback({
      request: new Request(`${SITE}/api/github/callback?code=x&state=${STATE}`),
      env: {},
    });
    expect(answer.status).toBe(503);
    expect(await answer.text()).toMatch(/not set up on this server/);
  });

  it('reads the secret from the Pages environment', async () => {
    const answer = await callback({
      request: new Request(`${SITE}/api/github/callback?state=${STATE}`),
      env: SECRET,
    });
    expect(answer.status).toBe(400);
    expect(await answer.text()).toMatch(/no authorization code/);
  });
});

describe('/api/github/refresh and /revoke on Pages', () => {
  const post = (path: string, origin: string, body: string) =>
    new Request(`${SITE}${path}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body,
    });

  it('refresh: only POST', async () => {
    const answer = await refresh({
      request: new Request(`${SITE}/api/github/refresh`),
      env: SECRET,
    });
    expect(answer.status).toBe(405);
    expect(answer.headers.get('allow')).toBe('POST');
  });

  it('refresh: refuses another site, accepts its own host, and reads the JSON body', async () => {
    const foreign = await refresh({
      request: post('/api/github/refresh', 'https://evil.example', '{}'),
      env: SECRET,
    });
    expect(foreign.status).toBe(403);
    const own = await refresh({ request: post('/api/github/refresh', SITE, '{}'), env: SECRET });
    expect(own.status).toBe(400);
    expect(await own.json()).toMatchObject({ error: 'missing_refresh_token' });
  });

  it('refresh: a preview address is its own origin', async () => {
    const preview = 'https://abc123.ziroeda-designer.pages.dev';
    const answer = await refresh({
      request: new Request(`${preview}/api/github/refresh`, {
        method: 'POST',
        headers: { Origin: preview },
        body: '{}',
      }),
      env: SECRET,
    });
    expect(answer.status).toBe(400);
  });

  it('revoke: refuses another site', async () => {
    const answer = await revoke({
      request: post('/api/github/revoke', 'https://evil.example', '{}'),
      env: SECRET,
    });
    expect(answer.status).toBe(403);
  });
});
