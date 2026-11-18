// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * POST /api/github/refresh  { "refresh_token": "..." }  ->  a new token pair
 *
 * The OAuth app's user tokens expire after eight hours; a refresh token trades
 * for a new pair (`grant_type=refresh_token`), and that trade needs the client
 * secret too, so it happens here and not in the browser.
 *
 * Same-origin only: the `Origin` header must be this server's own (or
 * `APP_ORIGIN`). A browser always sends it on a POST, and a page elsewhere
 * cannot forge it - so no other site can use this endpoint to spend a refresh
 * token it somehow holds.
 *
 * GitHub's answer goes back as it came: the tokens, or its `error` and
 * `error_description`, which the app shows as it is and then offers "Connect
 * GitHub..." again. Plain ESM, no dependencies, tokens never logged.
 */

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEFAULT_CLIENT_ID = 'Ov23liGnKwht1kDri6zX';
const DEFAULT_APP_ORIGIN = 'https://designer.ziroeda.com';
export const NOT_CONFIGURED = 'GitHub is not set up on this server yet.';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** The request's JSON body: Vercel parses it into `req.body`; plain Node leaves the stream. */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (req.body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(req.body));
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function createRefreshHandler(options = {}) {
  return async function handler(req, res) {
    const fetchFn = options.fetch ?? globalThis.fetch;
    const env = options.env ?? process.env;

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'method_not_allowed', error_description: 'Use POST.' });
      return;
    }
    const origin = req.headers?.origin;
    const host = req.headers?.host;
    const allowed = new Set([env.APP_ORIGIN || DEFAULT_APP_ORIGIN]);
    if (host) {
      allowed.add(`https://${host}`);
      // A local `vercel dev` serves plain http on localhost and nowhere else.
      if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) allowed.add(`http://${host}`);
    }
    if (!origin || !allowed.has(origin)) {
      sendJson(res, 403, {
        error: 'forbidden',
        error_description: 'Only ZiroEDA itself can refresh a GitHub connection.',
      });
      return;
    }
    const secret = env.GITHUB_CLIENT_SECRET;
    if (!secret) {
      sendJson(res, 503, { error: 'not_configured', error_description: NOT_CONFIGURED });
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      body = {};
    }
    const refreshToken = body?.refresh_token;
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      sendJson(res, 400, {
        error: 'missing_refresh_token',
        error_description: 'No refresh token was sent.',
      });
      return;
    }

    let answer;
    let status;
    try {
      const r = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID,
          client_secret: secret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      status = r.status;
      answer = await r.json().catch(() => ({}));
    } catch {
      sendJson(res, 502, {
        error: 'unreachable',
        error_description: 'GitHub could not be reached. Try again in a moment.',
      });
      return;
    }
    if (answer.error || !answer.access_token) {
      sendJson(res, 400, {
        error: String(answer.error || 'refresh_failed'),
        error_description: String(
          answer.error_description || answer.error || `GitHub answered ${status}.`,
        ),
      });
      return;
    }
    sendJson(res, 200, {
      access_token: answer.access_token,
      refresh_token: answer.refresh_token,
      expires_in: answer.expires_in,
      refresh_token_expires_in: answer.refresh_token_expires_in,
      scope: answer.scope,
      token_type: answer.token_type,
    });
  };
}

export default createRefreshHandler();
