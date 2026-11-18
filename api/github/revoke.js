// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * POST /api/github/revoke  { "access_token": "..." }  ->  { "revoked": true }
 *
 * Version Control > Disconnect GitHub: GitHub is told to forget this device's
 * token, before the app forgets it too.
 *
 * `DELETE /applications/{client_id}/token`, not `/grant`. GitHub's docs: the
 * token endpoint revokes "a single token for an OAuth application or a GitHub
 * application with an OAuth authorization"; the grant endpoint revokes the
 * grant and "will also delete all OAuth tokens associated with the application
 * for the user" - every other device of the person's would be signed out of
 * GitHub too, for a click that says it disconnects this one. Either needs Basic
 * authentication with the app's client id and secret, which is why this is a
 * server function: the secret never reaches a browser.
 *
 * Disconnecting does not uninstall the App, and is not meant to: the
 * installation (and which repositories it may use) is the person's, managed on
 * GitHub, and the app links them there.
 *
 * Same-origin only (`Origin` must be this server's own, or `APP_ORIGIN`), as
 * refresh.js. A token GitHub no longer knows (404, 422) is already as revoked as
 * it can be, and is answered as such. Plain ESM, no dependencies, tokens never
 * logged.
 */

/** The ZiroEDA GitHub App's (see callback.js for why not `GITHUB_CLIENT_ID`). */
const DEFAULT_CLIENT_ID = 'Iv23liWBsV0BNxfsmQQ8';
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

export function createRevokeHandler(options = {}) {
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
      if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) allowed.add(`http://${host}`);
    }
    if (!origin || !allowed.has(origin)) {
      sendJson(res, 403, {
        error: 'forbidden',
        error_description: 'Only ZiroEDA itself can disconnect a GitHub connection.',
      });
      return;
    }
    const secret = env.GITHUB_APP_CLIENT_SECRET;
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
    const token = body?.access_token;
    if (typeof token !== 'string' || token === '') {
      sendJson(res, 400, {
        error: 'missing_access_token',
        error_description: 'No access token was sent.',
      });
      return;
    }

    const clientId = env.GITHUB_APP_CLIENT_ID || DEFAULT_CLIENT_ID;
    let status;
    let answer = {};
    try {
      const r = await fetchFn(`https://api.github.com/applications/${clientId}/token`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        },
        body: JSON.stringify({ access_token: token }),
      });
      status = r.status;
      if (status !== 204) answer = await r.json().catch(() => ({}));
    } catch {
      sendJson(res, 502, {
        error: 'unreachable',
        error_description: 'GitHub could not be reached. Try again in a moment.',
      });
      return;
    }
    // 204: revoked. 404 / 422: GitHub does not know the token (expired, or revoked already).
    if (status === 204 || status === 404 || status === 422) {
      sendJson(res, 200, { revoked: true });
      return;
    }
    sendJson(res, 502, {
      error: 'revoke_failed',
      error_description: String(answer.message || `GitHub answered ${status}.`),
    });
  };
}

export default createRevokeHandler();
