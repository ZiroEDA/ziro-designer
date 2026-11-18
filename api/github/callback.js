// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * GET /api/github/callback?code=...&state=...
 *
 * Where GitHub sends the person back after "Authorize" in the OAuth app's web
 * flow. The code is traded for tokens HERE, because the trade needs the
 * client secret and the secret must never reach a browser
 * (`GITHUB_CLIENT_SECRET`, set in the Vercel project's environment).
 *
 * The answer is a page that hands the tokens - or GitHub's error - to the app
 * window that opened it, and closes:
 *
 *  - `window.opener.postMessage(data, <this page's own origin>)`: never `*`.
 *    This page is served from the app's origin, so its own origin IS the app's,
 *    exactly, in every deployment.
 *  - a same-origin `BroadcastChannel`, because a Cross-Origin-Opener-Policy on
 *    the way through GitHub can sever the opener link.
 *
 * `state` is passed back unchanged; the app accepts the answer only for the
 * state it sent (designer/src/github/github_auth.ts, acceptCallbackMessage).
 * Here it is only checked for shape, so nothing hostile is echoed into the
 * page, and a malformed one is not even traded.
 *
 * Plain ESM with no dependencies (Node 20's fetch). Tokens are never logged.
 */

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
/** The OAuth app's client id: public, and the default when the environment does not set one. */
const DEFAULT_CLIENT_ID = 'Ov23liGnKwht1kDri6zX';
/** The callback URL registered with the OAuth app (the exchange must name the same one). */
const DEFAULT_REDIRECT_URI = 'https://designer.ziroeda.com/api/github/callback';

export const MESSAGE_TYPE = 'ziroeda-github';
export const NOT_CONFIGURED = 'GitHub is not set up on this server yet.';
/** What the app's `newState` makes: base64url, 43 characters; a little room either way. */
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** JSON that can sit inside a <script> without ending it. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The page. With `data`, it hands it over and closes; without (a state that is
 * not ours), it only says what happened.
 */
export function callbackPage(nonce, text, data) {
  const script = data
    ? `<script nonce="${nonce}">
(function () {
  var data = ${scriptJson(data)};
  try { if (window.opener) window.opener.postMessage(data, window.location.origin); } catch (e) {}
  try { var ch = new BroadcastChannel(${scriptJson(MESSAGE_TYPE)}); ch.postMessage(data); ch.close(); } catch (e) {}
  window.close();
})();
</script>`
    : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GitHub</title></head>
<body><p>${escapeHtml(text)}</p>${script}</body>
</html>
`;
}

function sendPage(res, status, text, data) {
  const nonce = globalThis.crypto.randomUUID().replace(/-/g, '');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The page carries tokens: never cached, never sent on as a referrer, and it runs nothing but
  // its own script.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'`);
  res.end(callbackPage(nonce, text, data));
}

/** `fetch` and the environment are passed in so a test can stand in for GitHub. */
export function createCallbackHandler(options = {}) {
  return async function handler(req, res) {
    const fetchFn = options.fetch ?? globalThis.fetch;
    const env = options.env ?? process.env;
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const state = query.get('state') ?? '';

    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end();
      return;
    }
    if (!STATE_RE.test(state)) {
      sendPage(
        res,
        400,
        'This sign-in did not come from ZiroEDA. Close this window and connect GitHub again from the app.',
      );
      return;
    }
    const fail = (status, error, description) =>
      sendPage(res, status, description, {
        type: MESSAGE_TYPE,
        state,
        error,
        error_description: description,
      });

    // The person pressed Cancel on GitHub's page, or GitHub refused: its own words.
    const denied = query.get('error');
    if (denied) {
      fail(200, denied, query.get('error_description') || denied);
      return;
    }
    const secret = env.GITHUB_CLIENT_SECRET;
    if (!secret) {
      fail(503, 'not_configured', NOT_CONFIGURED);
      return;
    }
    const code = query.get('code');
    if (!code) {
      fail(400, 'missing_code', 'GitHub sent no authorization code.');
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
          code,
          redirect_uri: env.GITHUB_REDIRECT_URI || DEFAULT_REDIRECT_URI,
        }),
      });
      status = r.status;
      answer = await r.json().catch(() => ({}));
    } catch {
      fail(502, 'unreachable', 'GitHub could not be reached. Try again in a moment.');
      return;
    }
    // GitHub answers an error with 200 and an `error` field ("bad_verification_code").
    if (answer.error || !answer.access_token) {
      fail(
        502,
        String(answer.error || 'exchange_failed'),
        String(answer.error_description || answer.error || `GitHub answered ${status}.`),
      );
      return;
    }
    sendPage(res, 200, 'GitHub is connected. You can close this window.', {
      type: MESSAGE_TYPE,
      state,
      access_token: answer.access_token,
      refresh_token: answer.refresh_token,
      expires_in: answer.expires_in,
      refresh_token_expires_in: answer.refresh_token_expires_in,
      scope: answer.scope,
      token_type: answer.token_type,
    });
  };
}

export default createCallbackHandler();
