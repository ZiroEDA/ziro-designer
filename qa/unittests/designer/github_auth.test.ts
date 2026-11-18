// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Connecting GitHub (designer/src/github/github_auth.ts): the callback's state check, the token
 * store, and the session's refresh - the parts where a mistake is a stolen or spent token rather
 * than a wrong pixel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  GITHUB_CALLBACK_URL,
  GITHUB_CLIENT_ID,
  GITHUB_MESSAGE_TYPE,
  GithubAuthError,
  GithubAuthRequired,
  GithubSession,
  type GithubTokens,
  type KeyValueStore,
  acceptCallbackMessage,
  beginGithubConnect,
  authorizeUrl,
  clearTokens,
  loadTokens,
  newState,
  saveTokens,
  tokenKey,
} from '@ziroeda/designer/src/github/github_auth.js';
import { setLocalVaultKey } from '@ziroeda/designer/src/home/local_vault.js';

const NOW = 1_800_000_000_000;
const STATE = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

describe('the authorize URL', () => {
  it('names the app, the registered callback, the repo scope and the state', () => {
    const u = new URL(authorizeUrl(STATE));
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('Ov23liGnKwht1kDri6zX');
    expect(GITHUB_CLIENT_ID).toBe('Ov23liGnKwht1kDri6zX');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://designer.ziroeda.com/api/github/callback',
    );
    expect(GITHUB_CALLBACK_URL).toBe('https://designer.ziroeda.com/api/github/callback');
    expect(u.searchParams.get('scope')).toBe('repo');
    expect(u.searchParams.get('state')).toBe(STATE);
  });

  it('makes a fresh, URL-safe state each time that the callback will accept', () => {
    const a = newState();
    const b = newState();
    expect(a).not.toBe(b);
    // api/github/callback.js accepts /^[A-Za-z0-9_-]{16,128}$/.
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });
});

describe("the callback page's message", () => {
  const msg = (over: Record<string, unknown>) => ({
    type: 'ziroeda-github',
    state: STATE,
    access_token: 'gho_fake',
    refresh_token: 'ghr_fake',
    expires_in: 28800,
    refresh_token_expires_in: 15897600,
    ...over,
  });

  it('is taken with the state this window sent', () => {
    expect(acceptCallbackMessage(msg({}), STATE, NOW)).toEqual({
      accessToken: 'gho_fake',
      refreshToken: 'ghr_fake',
      expiresAt: NOW + 28_800_000,
      refreshExpiresAt: NOW + 15_897_600_000,
    });
  });

  it('is ignored with any other state, or none', () => {
    expect(acceptCallbackMessage(msg({ state: `${STATE}x` }), STATE, NOW)).toBeNull();
    expect(acceptCallbackMessage(msg({ state: undefined }), STATE, NOW)).toBeNull();
    // A window with no attempt pending (empty expected state) takes nothing, even an empty one.
    expect(acceptCallbackMessage(msg({ state: '' }), '', NOW)).toBeNull();
  });

  it('is ignored when it is not ours at all', () => {
    expect(acceptCallbackMessage(msg({ type: 'other' }), STATE, NOW)).toBeNull();
    expect(acceptCallbackMessage('gho_fake', STATE, NOW)).toBeNull();
    expect(acceptCallbackMessage(null, STATE, NOW)).toBeNull();
  });

  it("an error for our state is the server's or GitHub's own words", () => {
    expect(() =>
      acceptCallbackMessage(
        msg({
          error: 'not_configured',
          error_description: 'GitHub is not set up on this server yet.',
        }),
        STATE,
        NOW,
      ),
    ).toThrow(new GithubAuthError('GitHub is not set up on this server yet.'));
    // ...and an error for someone else's state is not ours to show.
    expect(
      acceptCallbackMessage(msg({ state: 'x'.repeat(43), error: 'access_denied' }), STATE, NOW),
    ).toBeNull();
  });
});

const memoryStore = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

describe('the tokens on this device', () => {
  afterEach(() => setLocalVaultKey(null));
  const tokens: GithubTokens = {
    accessToken: 'gho_secret',
    refreshToken: 'ghr_secret',
    expiresAt: 5,
  };

  it('are kept per account', async () => {
    const store = memoryStore();
    await saveTokens('user-a', tokens, store);
    expect([...store.map.keys()]).toEqual([tokenKey('user-a')]);
    expect(tokenKey('user-a')).toContain('user-a');
    expect(await loadTokens('user-a', store)).toEqual(tokens);
    expect(await loadTokens('user-b', store)).toBeNull();
    clearTokens('user-a', store);
    expect(await loadTokens('user-a', store)).toBeNull();
  });

  it('are sealed under the local vault when the account has one, and unreadable without it', async () => {
    const store = memoryStore();
    setLocalVaultKey(new Uint8Array(32).fill(7));
    await saveTokens('user-a', tokens, store);
    const raw = store.map.get(tokenKey('user-a'))!;
    expect(raw).not.toContain('gho_secret');
    expect(raw).not.toContain('ghr_secret');
    expect(await loadTokens('user-a', store)).toEqual(tokens);
    setLocalVaultKey(new Uint8Array(32).fill(8)); // another account's key
    expect(await loadTokens('user-a', store)).toBeNull();
    setLocalVaultKey(null); // locked
    expect(await loadTokens('user-a', store)).toBeNull();
  });
});

/** A session over a fake network: GitHub's API and our refresh endpoint. */
function harness(
  start: GithubTokens | null,
  opts: { refresh?: 'ok' | 'fail'; api401?: Set<string> } = {},
) {
  let stored = start;
  let cleared = 0;
  const refreshBodies: unknown[] = [];
  const apiAuth: string[] = [];
  let n = 0;
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    if (url === '/api/github/refresh') {
      refreshBodies.push(JSON.parse(String(init.body)));
      if (opts.refresh === 'fail')
        return new Response(
          JSON.stringify({
            error: 'bad_refresh_token',
            error_description: 'The refresh token passed is incorrect or expired.',
          }),
          { status: 400 },
        );
      n += 1;
      return new Response(
        JSON.stringify({
          access_token: `gho_new${n}`,
          refresh_token: `ghr_new${n}`,
          expires_in: 28800,
        }),
        { status: 200 },
      );
    }
    const auth = new Headers(init.headers).get('Authorization') ?? '';
    apiAuth.push(auth);
    if (opts.api401?.has(auth))
      return new Response('{"message":"Bad credentials"}', { status: 401 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const session = new GithubSession({
    fetch: fetchFn,
    now: () => NOW,
    load: async () => stored,
    save: async (t) => {
      stored = t;
    },
    clear: () => {
      cleared += 1;
      stored = null;
    },
  });
  return {
    session,
    refreshBodies,
    apiAuth,
    get stored() {
      return stored;
    },
    get cleared() {
      return cleared;
    },
  };
}

describe('the GitHub session', () => {
  it('sends the token as a bearer token', async () => {
    const h = harness({ accessToken: 'gho_a', expiresAt: NOW + 3_600_000 });
    await h.session.fetch('https://api.github.com/user');
    expect(h.apiAuth).toEqual(['Bearer gho_a']);
    expect(h.refreshBodies).toEqual([]);
  });

  it('refreshes an expired token first, through the server, and keeps the new pair', async () => {
    const h = harness({
      accessToken: 'gho_old',
      refreshToken: 'ghr_old',
      expiresAt: NOW - 1,
      login: 'octo',
    });
    await h.session.fetch('https://api.github.com/user');
    expect(h.refreshBodies).toEqual([{ refresh_token: 'ghr_old' }]);
    expect(h.apiAuth).toEqual(['Bearer gho_new1']);
    expect(h.stored).toEqual({
      accessToken: 'gho_new1',
      refreshToken: 'ghr_new1',
      expiresAt: NOW + 28_800_000,
      login: 'octo',
    });
  });

  it('refreshes a token within a minute of expiring', async () => {
    const h = harness({ accessToken: 'gho_old', refreshToken: 'ghr_old', expiresAt: NOW + 30_000 });
    await h.session.fetch('https://api.github.com/user');
    expect(h.refreshBodies).toHaveLength(1);
  });

  it('spends a refresh token once, however many requests found it expired', async () => {
    const h = harness({ accessToken: 'gho_old', refreshToken: 'ghr_old', expiresAt: NOW - 1 });
    await Promise.all([
      h.session.fetch('https://api.github.com/a'),
      h.session.fetch('https://api.github.com/b'),
      h.session.fetch('https://api.github.com/c'),
    ]);
    expect(h.refreshBodies).toEqual([{ refresh_token: 'ghr_old' }]);
    expect(h.apiAuth).toEqual(['Bearer gho_new1', 'Bearer gho_new1', 'Bearer gho_new1']);
  });

  it('refreshes once on a 401 and retries', async () => {
    const h = harness(
      { accessToken: 'gho_revoked', refreshToken: 'ghr_old', expiresAt: NOW + 3_600_000 },
      { api401: new Set(['Bearer gho_revoked']) },
    );
    const res = await h.session.fetch('https://api.github.com/user');
    expect(res.status).toBe(200);
    expect(h.apiAuth).toEqual(['Bearer gho_revoked', 'Bearer gho_new1']);
  });

  it('forgets the connection when the refresh is refused, so Connect GitHub... is offered', async () => {
    const h = harness(
      { accessToken: 'gho_old', refreshToken: 'ghr_old', expiresAt: NOW - 1 },
      { refresh: 'fail' },
    );
    await expect(h.session.fetch('https://api.github.com/user')).rejects.toThrow(
      new GithubAuthRequired('The refresh token passed is incorrect or expired.'),
    );
    expect(h.cleared).toBe(1);
    expect(h.stored).toBeNull();
    expect(h.apiAuth).toEqual([]);
  });

  it('forgets it when GitHub still refuses the refreshed token', async () => {
    const h = harness(
      { accessToken: 'gho_old', refreshToken: 'ghr_old', expiresAt: NOW + 3_600_000 },
      { api401: new Set(['Bearer gho_old', 'Bearer gho_new1']) },
    );
    await expect(h.session.fetch('https://api.github.com/user')).rejects.toBeInstanceOf(
      GithubAuthRequired,
    );
    expect(h.stored).toBeNull();
  });

  it('with no tokens at all, asks for a connection without touching the network', async () => {
    const h = harness(null);
    await expect(h.session.fetch('https://api.github.com/user')).rejects.toBeInstanceOf(
      GithubAuthRequired,
    );
    expect(h.apiAuth).toEqual([]);
  });

  it('a token with no refresh token, expired, is a new connection', async () => {
    const h = harness({ accessToken: 'gho_old', expiresAt: NOW - 1 });
    await expect(h.session.fetch('https://api.github.com/user')).rejects.toBeInstanceOf(
      GithubAuthRequired,
    );
    expect(h.cleared).toBe(1);
    expect(h.refreshBodies).toEqual([]);
  });
});

describe("the GitHub window's answer", () => {
  /** A window that records its message listeners and the URL it opened. */
  function fakeWindow() {
    const listeners: ((e: MessageEvent) => void)[] = [];
    let opened = '';
    const win = {
      location: { origin: 'https://designer.ziroeda.com' },
      open: (url: string) => {
        opened = url;
        return {};
      },
      addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
      removeEventListener: () => {},
    } as unknown as Window;
    const post = (origin: string, data: unknown) =>
      listeners.forEach((fn) => fn({ origin, data } as MessageEvent));
    return { win, post, state: () => new URL(opened).searchParams.get('state')! };
  }

  it('is taken from this site only: the same message from another origin is ignored', async () => {
    const w = fakeWindow();
    let settled = false;
    const connect = beginGithubConnect(w.win).then((t) => {
      settled = true;
      return t;
    });
    const answer = {
      type: GITHUB_MESSAGE_TYPE,
      state: w.state(),
      access_token: 'gho_fake',
      refresh_token: 'ghr_fake',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    };
    // Any page holding a reference to this window can post to it; only the callback page on
    // this site may hand it tokens.
    w.post('https://evil.example', answer);
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    w.post('https://designer.ziroeda.com', answer);
    expect((await connect).accessToken).toBe('gho_fake');
  });
});
