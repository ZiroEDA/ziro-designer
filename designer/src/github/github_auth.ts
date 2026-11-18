// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Connecting a GitHub account: the OAuth web flow, the tokens it yields, and a
 * `fetch` that carries them.
 *
 * KiCad asks for git credentials per remote (DIALOG_GIT_CREDENTIALS) and keeps
 * them in the OS keychain (`KIPLATFORM::SECRETS::StoreSecret`). A browser has
 * neither a keychain nor git, so ours is what browser coding tools do: the
 * person signs in to GitHub once, in a small GitHub window, and the app holds a
 * token that `api.github.com` accepts.
 *
 * ## The flow
 *
 * 1. `beginGithubConnect` opens `github.com/login/oauth/authorize` in a popup
 *    with a random `state`, and listens.
 * 2. GitHub sends the person to `/api/github/callback` (api/github/callback.js),
 *    which trades the code for tokens with the client secret - which only the
 *    server has - and answers with a page that hands them back to this window
 *    and closes.
 * 3. `acceptCallbackMessage` takes them only with the `state` this window sent.
 *
 * The page hands them back twice: `window.opener.postMessage` to this exact
 * origin, and a same-origin `BroadcastChannel`. The opener link does not
 * survive every browser's handling of a cross-origin popup (a
 * Cross-Origin-Opener-Policy on the way through severs it); the channel does.
 *
 * ## The tokens
 *
 * The OAuth app issues expiring user tokens: the access token lasts eight
 * hours, and a refresh token trades for a new pair (`/api/github/refresh`, the
 * secret again). Once used, a refresh token and the access token it replaced
 * are both dead, so every refresh in this window goes through ONE in-flight
 * promise - two requests that both saw an expired token must not both spend
 * it.
 *
 * Kept on this device only, per account (`tokenKey`), sealed under the local
 * vault key like a project record (home/local_vault.ts): readable only while
 * the account is open, and never part of the synced settings.
 */
import { base64ToBytes, bytesToBase64 } from '../cloud/crypto.js';
import { isSealed, openRecord, sealRecord } from '../home/local_vault.js';

/**
 * The ZiroEDA OAuth app's client id. Public by design - it is in every
 * authorize URL - so it is written here rather than configured; the secret
 * that goes with it lives only in the server's environment.
 */
export const GITHUB_CLIENT_ID = 'Ov23liGnKwht1kDri6zX';

/** The callback URL registered with the OAuth app; GitHub redirects nowhere else. */
export const GITHUB_CALLBACK_URL = 'https://designer.ziroeda.com/api/github/callback';

/** `repo`: read and write the person's repositories, private ones included. */
export const GITHUB_SCOPE = 'repo';

/** The `type` of the callback page's message, and the name of its channel. */
export const GITHUB_MESSAGE_TYPE = 'ziroeda-github';

export const GITHUB_REFRESH_ENDPOINT = '/api/github/refresh';

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: GITHUB_SCOPE,
    state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${q}`;
}

/** 32 random bytes, base64url: unguessable, and safe in a URL. */
export function newState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface GithubTokens {
  accessToken: string;
  refreshToken?: string;
  /** When the access token stops working (ms since the epoch); absent, it does not expire. */
  expiresAt?: number;
  /** When the refresh token does. */
  refreshExpiresAt?: number;
  /** The GitHub account, once asked. */
  login?: string;
}

/** The person has to connect GitHub (again): no tokens, or none that GitHub will take. */
export class GithubAuthRequired extends Error {}

/** Connecting failed, in words for the person (GitHub's, or the server's). */
export class GithubAuthError extends Error {}

/** A token answer as the server functions relay GitHub's (`/login/oauth/access_token`). */
export interface TokenAnswer {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/** GitHub's own sentence for an error answer, or its code. */
function answerError(a: TokenAnswer): string | null {
  if (a.error === undefined || a.error === null || a.error === '') return null;
  return typeof a.error_description === 'string' && a.error_description
    ? a.error_description
    : String(a.error);
}

/** Tokens from an answer; throws {@link GithubAuthError} with GitHub's words for an error. */
export function tokensFromAnswer(a: TokenAnswer, now: number): GithubTokens {
  const why = answerError(a);
  if (why !== null) throw new GithubAuthError(why);
  if (typeof a.access_token !== 'string' || a.access_token === '')
    throw new GithubAuthError('GitHub did not send a token.');
  const out: GithubTokens = { accessToken: a.access_token };
  if (typeof a.refresh_token === 'string' && a.refresh_token) out.refreshToken = a.refresh_token;
  const exp = Number(a.expires_in);
  if (Number.isFinite(exp) && exp > 0) out.expiresAt = now + exp * 1000;
  const rexp = Number(a.refresh_token_expires_in);
  if (Number.isFinite(rexp) && rexp > 0) out.refreshExpiresAt = now + rexp * 1000;
  return out;
}

/**
 * The callback page's message, if it is the answer to `expectedState`.
 *
 * Null for anything else - another type, or another state, which is either a
 * stale window from an earlier attempt or someone else's page: never taken.
 * Throws {@link GithubAuthError} when the answer to OUR state is an error.
 */
export function acceptCallbackMessage(
  data: unknown,
  expectedState: string,
  now: number,
): GithubTokens | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as TokenAnswer & { type?: unknown; state?: unknown };
  if (d.type !== GITHUB_MESSAGE_TYPE) return null;
  if (typeof d.state !== 'string' || expectedState === '' || d.state !== expectedState) return null;
  return tokensFromAnswer(d, now);
}

// --- storage -----------------------------------------------------------------

/** What tokens are kept in: localStorage in the app, a Map in a test. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One key per account on this device; `guest` when nobody is signed in. */
export const tokenKey = (userKey: string): string => `ziroeda.github.v1.${userKey}`;

const defaultStore = (): KeyValueStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export async function loadTokens(
  userKey: string,
  store: KeyValueStore | null = defaultStore(),
): Promise<GithubTokens | null> {
  const raw = store?.getItem(tokenKey(userKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { sealed?: string; v?: 1 } | GithubTokens;
    const rec =
      'sealed' in parsed && typeof parsed.sealed === 'string'
        ? await openRecord<GithubTokens>({ sealed: base64ToBytes(parsed.sealed), v: 1 })
        : (parsed as GithubTokens);
    return rec && typeof rec.accessToken === 'string' ? rec : null;
  } catch {
    return null;
  }
}

export async function saveTokens(
  userKey: string,
  tokens: GithubTokens,
  store: KeyValueStore | null = defaultStore(),
): Promise<void> {
  if (!store) return;
  const rec = await sealRecord(tokens, []);
  store.setItem(
    tokenKey(userKey),
    JSON.stringify(isSealed(rec) ? { v: 1, sealed: bytesToBase64(rec.sealed) } : rec),
  );
}

export function clearTokens(userKey: string, store: KeyValueStore | null = defaultStore()): void {
  store?.removeItem(tokenKey(userKey));
}

// --- refresh -----------------------------------------------------------------

/**
 * Trade a refresh token for a new pair through the server. Any failure is
 * {@link GithubAuthRequired}: the person connects again, with the server's
 * reason (which is GitHub's, or "not set up on this server yet").
 */
export async function refreshTokens(
  refreshToken: string,
  fetchFn: typeof fetch,
  now: number,
  endpoint: string = GITHUB_REFRESH_ENDPOINT,
): Promise<GithubTokens> {
  let res: Response;
  try {
    res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (e) {
    throw new GithubAuthRequired(e instanceof Error ? e.message : String(e));
  }
  const answer = (await res.json().catch(() => ({}))) as TokenAnswer;
  const why = answerError(answer);
  if (!res.ok || why !== null)
    throw new GithubAuthRequired(why ?? `The refresh failed (HTTP ${res.status}).`);
  try {
    return tokensFromAnswer(answer, now);
  } catch (e) {
    throw new GithubAuthRequired(e instanceof Error ? e.message : String(e));
  }
}

/** Refresh this long before the stated expiry, so a request never leaves with a dying token. */
export const EXPIRY_MARGIN_MS = 60_000;

export interface GithubSessionDeps {
  /** The network: the app's fetch, or a fake. */
  fetch: typeof fetch;
  load: () => Promise<GithubTokens | null>;
  save: (t: GithubTokens) => Promise<void>;
  clear: () => Promise<void> | void;
  now?: () => number;
  refreshEndpoint?: string;
}

/**
 * The tokens of one account on this device, and a `fetch` for
 * `api.github.com` that carries them: refreshed before they expire, refreshed
 * once more on a 401, and cleared - so the menu offers "Connect GitHub..."
 * again - when GitHub will not take them.
 */
export class GithubSession {
  private refreshing: Promise<GithubTokens> | null = null;

  constructor(private readonly deps: GithubSessionDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private expired(t: GithubTokens): boolean {
    return t.expiresAt !== undefined && this.now() >= t.expiresAt - EXPIRY_MARGIN_MS;
  }

  /** One refresh at a time: a refresh token works once. */
  private refresh(t: GithubTokens): Promise<GithubTokens> {
    if (this.refreshing) return this.refreshing;
    const run = async (): Promise<GithubTokens> => {
      if (!t.refreshToken) {
        await this.deps.clear();
        throw new GithubAuthRequired('The GitHub connection has expired.');
      }
      try {
        const next = await refreshTokens(
          t.refreshToken,
          this.deps.fetch,
          this.now(),
          this.deps.refreshEndpoint,
        );
        const merged: GithubTokens = t.login ? { ...next, login: t.login } : next;
        await this.deps.save(merged);
        return merged;
      } catch (e) {
        await this.deps.clear();
        throw e instanceof GithubAuthRequired ? e : new GithubAuthRequired(String(e));
      }
    };
    this.refreshing = run().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The tokens to use now, refreshed if they are about to expire. */
  async tokens(): Promise<GithubTokens> {
    const t = await this.deps.load();
    if (!t) throw new GithubAuthRequired('GitHub is not connected.');
    return this.expired(t) ? this.refresh(t) : t;
  }

  /** `fetch` with the token on it. */
  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const send = (t: GithubTokens): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${t.accessToken}`);
      headers.set('X-GitHub-Api-Version', '2022-11-28');
      return this.deps.fetch(url, { ...init, headers });
    };
    const used = await this.tokens();
    const res = await send(used);
    if (res.status !== 401) return res;
    // Another request may already have refreshed: then the stored token is new, and is tried
    // as it is rather than spending the refresh token a second time.
    const stored = await this.deps.load();
    const next =
      stored && stored.accessToken !== used.accessToken && !this.expired(stored)
        ? stored
        : await this.refresh(stored ?? used);
    const again = await send(next);
    if (again.status === 401) {
      await this.deps.clear();
      throw new GithubAuthRequired('GitHub no longer accepts this connection.');
    }
    return again;
  };
}

// --- connecting --------------------------------------------------------------

/** How long a GitHub window is waited on before its listeners go. */
export const CONNECT_TIMEOUT_MS = 10 * 60_000;

let pendingConnect: (() => void) | null = null;

/**
 * Open GitHub's sign-in window and wait for its answer. Call from the click
 * itself: a window opened later is a pop-up the browser blocks.
 *
 * The promise settles when the callback page answers (with tokens, or with an
 * error in words). Closing the window settles nothing - which window closed
 * cannot be told apart from an opener link the browser severed - and a second
 * attempt drops the first one's listeners.
 */
export function beginGithubConnect(win: Window = window): Promise<GithubTokens> {
  pendingConnect?.();
  const state = newState();
  const popup = win.open(authorizeUrl(state), 'ziroeda-github', 'popup,width=720,height=800');
  if (!popup)
    return Promise.reject(
      new GithubAuthError(
        'The browser blocked the GitHub window. Allow pop-ups for this site, then try again.',
      ),
    );
  return new Promise<GithubTokens>((resolve, reject) => {
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(GITHUB_MESSAGE_TYPE);
    const done = (): void => {
      win.removeEventListener('message', onWindowMessage);
      channel?.close();
      clearTimeout(timer);
      if (pendingConnect === done) pendingConnect = null;
    };
    const take = (data: unknown): void => {
      try {
        const t = acceptCallbackMessage(data, state, Date.now());
        if (!t) return;
        done();
        resolve(t);
      } catch (e) {
        done();
        reject(e);
      }
    };
    const onWindowMessage = (e: MessageEvent): void => {
      if (e.origin === win.location.origin) take(e.data);
    };
    win.addEventListener('message', onWindowMessage);
    channel?.addEventListener('message', (e) => take((e as MessageEvent).data));
    const timer = setTimeout(done, CONNECT_TIMEOUT_MS);
    pendingConnect = done;
  });
}
