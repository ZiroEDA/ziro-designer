// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The two Vercel functions that hold the OAuth client secret (api/github/callback.js and
 * refresh.js), called as Vercel calls them - a request and a response - with GitHub replaced by a
 * fake `fetch`. No real secret or token appears anywhere here.
 *
 * Imported by a computed URL: they are plain JavaScript with no declarations, by design, and the
 * shape the test relies on is written out below.
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

type Handler = (req: unknown, res: FakeRes) => Promise<void>;
interface Factory {
  (options?: { fetch?: typeof fetch; env?: Record<string, string | undefined> }): Handler;
}

const load = async (name: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ new URL(`../../../api/github/${name}.js`, import.meta.url).href);

const { createCallbackHandler } = (await load('callback')) as { createCallbackHandler: Factory };
const { createRefreshHandler } = (await load('refresh')) as { createRefreshHandler: Factory };

class FakeRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';
  setHeader(k: string, v: string): void {
    this.headers[k.toLowerCase()] = v;
  }
  end(b?: string): void {
    this.body = b ?? '';
  }
  json(): Record<string, unknown> {
    return JSON.parse(this.body);
  }
  /** The data the callback page hands to the app, as its script holds it. */
  pageData(): Record<string, unknown> | null {
    const m = /var data = (.*);\n/.exec(this.body);
    return m ? JSON.parse(m[1]!) : null;
  }
}

const SECRET_ENV = { GITHUB_CLIENT_SECRET: 'test-secret-not-real' };
const STATE = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

/** A fake GitHub token endpoint that records what it was sent. */
function tokenEndpoint(answer: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(answer), { status });
  }) as typeof fetch;
  return { f, calls };
}

const get = (query: string) => ({
  method: 'GET',
  url: `/api/github/callback?${query}`,
  headers: {},
});

describe('GET /api/github/callback', () => {
  it('trades the code with the secret and hands the tokens back with the state unchanged', async () => {
    const gh = tokenEndpoint({
      access_token: 'gho_fake',
      refresh_token: 'ghr_fake',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      token_type: 'bearer',
      scope: 'repo',
    });
    const res = new FakeRes();
    await createCallbackHandler({ fetch: gh.f, env: SECRET_ENV })(
      get(`code=c0de&state=${STATE}`),
      res,
    );

    expect(gh.calls).toEqual([
      {
        url: 'https://github.com/login/oauth/access_token',
        body: {
          client_id: 'Ov23liGnKwht1kDri6zX',
          client_secret: 'test-secret-not-real',
          code: 'c0de',
          redirect_uri: 'https://designer.ziroeda.com/api/github/callback',
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.pageData()).toEqual({
      type: 'ziroeda-github',
      state: STATE,
      access_token: 'gho_fake',
      refresh_token: 'ghr_fake',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      scope: 'repo',
      token_type: 'bearer',
    });
    // To this page's own origin - never '*' - and on the same-origin channel.
    expect(res.body).toContain('window.opener.postMessage(data, window.location.origin)');
    expect(res.body).not.toContain("'*'");
    expect(res.body).toContain('new BroadcastChannel("ziroeda-github")');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(
      res.headers['content-security-policy']!,
    )![1];
    expect(res.body).toContain(`<script nonce="${nonce}">`);
  });

  it('without the secret, says GitHub is not set up here, and asks GitHub nothing', async () => {
    const gh = tokenEndpoint({});
    const res = new FakeRes();
    await createCallbackHandler({ fetch: gh.f, env: {} })(get(`code=c0de&state=${STATE}`), res);
    expect(gh.calls).toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.pageData()).toEqual({
      type: 'ziroeda-github',
      state: STATE,
      error: 'not_configured',
      error_description: 'GitHub is not set up on this server yet.',
    });
  });

  it('refuses a malformed state outright: no trade, nothing handed over', async () => {
    const gh = tokenEndpoint({ access_token: 'gho_fake' });
    for (const state of ['short', '', '</script><script>alert(1)</script>abcdefghij']) {
      const res = new FakeRes();
      await createCallbackHandler({ fetch: gh.f, env: SECRET_ENV })(
        get(`code=c0de&state=${encodeURIComponent(state)}`),
        res,
      );
      expect(res.statusCode, state).toBe(400);
      expect(res.pageData(), state).toBeNull();
      expect(res.body).not.toContain('<script');
    }
    expect(gh.calls).toEqual([]);
  });

  it("passes GitHub's refusal back in its own words", async () => {
    const gh = tokenEndpoint({
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
    });
    const res = new FakeRes();
    await createCallbackHandler({ fetch: gh.f, env: SECRET_ENV })(
      get(`code=old&state=${STATE}`),
      res,
    );
    expect(res.pageData()).toMatchObject({
      state: STATE,
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
    });
    expect(res.pageData()).not.toHaveProperty('access_token');
  });

  it('a person who pressed Cancel on GitHub is told so, with nothing traded', async () => {
    const gh = tokenEndpoint({});
    const res = new FakeRes();
    const hostile = '</script><script>alert(1)</script>';
    await createCallbackHandler({ fetch: gh.f, env: SECRET_ENV })(
      get(`error=access_denied&error_description=${encodeURIComponent(hostile)}&state=${STATE}`),
      res,
    );
    expect(gh.calls).toEqual([]);
    expect(res.pageData()).toMatchObject({ error: 'access_denied', error_description: hostile });
    // The words are data: escaped in the script and in the page, never markup.
    expect(res.body.match(/<script/g)).toHaveLength(1);
    expect(res.body).toContain('&lt;/script&gt;');
  });
});

const post = (body: unknown, headers: Record<string, string>, asStream = false) =>
  asStream
    ? Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
        method: 'POST',
        headers,
        url: '/api/github/refresh',
      })
    : { method: 'POST', headers, body, url: '/api/github/refresh' };

const SAME = { origin: 'https://designer.ziroeda.com', host: 'designer.ziroeda.com' };

describe('POST /api/github/refresh', () => {
  it('trades the refresh token with the secret and returns the new pair', async () => {
    const gh = tokenEndpoint({
      access_token: 'gho_new',
      refresh_token: 'ghr_new',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    });
    const res = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(
      post({ refresh_token: 'ghr_old' }, SAME),
      res,
    );
    expect(gh.calls).toEqual([
      {
        url: 'https://github.com/login/oauth/access_token',
        body: {
          client_id: 'Ov23liGnKwht1kDri6zX',
          client_secret: 'test-secret-not-real',
          grant_type: 'refresh_token',
          refresh_token: 'ghr_old',
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ access_token: 'gho_new', refresh_token: 'ghr_new' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reads the body from the stream when nothing parsed it', async () => {
    const gh = tokenEndpoint({ access_token: 'gho_new' });
    const res = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(
      post({ refresh_token: 'ghr_old' }, SAME, true),
      res,
    );
    expect(gh.calls[0]!.body.refresh_token).toBe('ghr_old');
  });

  it('answers only its own origin', async () => {
    const gh = tokenEndpoint({ access_token: 'gho_new' });
    for (const headers of [
      { origin: 'https://evil.example', host: 'designer.ziroeda.com' } as Record<string, string>,
      { host: 'designer.ziroeda.com' },
      { origin: 'http://designer.ziroeda.com', host: 'designer.ziroeda.com' },
    ]) {
      const res = new FakeRes();
      await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(
        post({ refresh_token: 'ghr_old' }, headers),
        res,
      );
      expect(res.statusCode, JSON.stringify(headers)).toBe(403);
    }
    expect(gh.calls).toEqual([]);
    // A preview deployment is its own origin.
    const res = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(
      post(
        { refresh_token: 'ghr_old' },
        { origin: 'https://pr-1.vercel.app', host: 'pr-1.vercel.app' },
      ),
      res,
    );
    expect(res.statusCode).toBe(200);
  });

  it('without the secret, says GitHub is not set up here', async () => {
    const gh = tokenEndpoint({});
    const res = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: {} })(
      post({ refresh_token: 'ghr_old' }, SAME),
      res,
    );
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'not_configured',
      error_description: 'GitHub is not set up on this server yet.',
    });
    expect(gh.calls).toEqual([]);
  });

  it("passes GitHub's refusal back", async () => {
    const gh = tokenEndpoint({
      error: 'bad_refresh_token',
      error_description: 'The refresh token passed is incorrect or expired.',
    });
    const res = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(
      post({ refresh_token: 'x' }, SAME),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'bad_refresh_token',
      error_description: 'The refresh token passed is incorrect or expired.',
    });
  });

  it('refuses a GET and a body with no refresh token', async () => {
    const gh = tokenEndpoint({ access_token: 'x' });
    const res = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(
      { method: 'GET', headers: SAME, url: '/api/github/refresh' },
      res,
    );
    expect(res.statusCode).toBe(405);
    const res2 = new FakeRes();
    await createRefreshHandler({ fetch: gh.f, env: SECRET_ENV })(post({}, SAME), res2);
    expect(res2.statusCode).toBe(400);
    expect(gh.calls).toEqual([]);
  });
});
