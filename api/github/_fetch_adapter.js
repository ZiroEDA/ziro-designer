// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Runs the GitHub server functions (callback.js, refresh.js, revoke.js) on Cloudflare Pages.
 *
 * Those three are written as Node handlers - `handler(req, res)`, the shape Vercel calls - and
 * stay so: this file hands each one a request and a response of that shape, built from the
 * Fetch API `Request` Cloudflare gives a Pages Function, and turns what the handler wrote into a
 * `Response`. The handlers never learn where they run; `functions/api/github/*.js` are the
 * one-line routes that use this.
 *
 * Only what the handlers read is carried over: the method, the path and query, the headers (by
 * lower-case name, as Node gives them) and the body as text, which the handlers parse themselves.
 * The environment - the App's client secret, set in the Pages project - is passed in, never read
 * from `process.env`, which a Worker does not have.
 *
 * The leading underscore keeps Vercel from serving this file as a function of its own.
 */

/**
 * A Pages Function (`onRequest`) for the handler `aMake(env)` builds.
 *
 * @param {(env: Record<string, string | undefined>) => (req: object, res: object) => Promise<void>} aMake
 * @returns {(context: { request: Request, env: Record<string, string | undefined> }) => Promise<Response>}
 */
export function toPagesFunction(aMake) {
  return async function onRequest({ request, env }) {
    const url = new URL(request.url);
    /** @type {Record<string, string>} */
    const headers = {};
    request.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    // refresh.js and revoke.js accept the origin of the host they are served from; Node always
    // has a Host header, and the URL's host is the same name when a runtime leaves it out.
    if (!headers.host) headers.host = url.host;
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
      body: hasBody ? await request.text() : undefined,
    };

    let status = 200;
    const out = new Headers();
    /** @type {string | Uint8Array} */
    let body = '';
    const res = {
      get statusCode() {
        return status;
      },
      set statusCode(aStatus) {
        status = aStatus;
      },
      setHeader(aName, aValue) {
        out.set(aName, String(aValue));
      },
      end(aChunk) {
        if (aChunk !== undefined && aChunk !== null) body = aChunk;
      },
    };

    await aMake(env ?? {})(req, res);
    // A HEAD answer, and the statuses that carry none, must not have a body.
    const empty = request.method === 'HEAD' || status === 204 || status === 304;
    return new Response(empty ? null : body, { status, headers: out });
  };
}
