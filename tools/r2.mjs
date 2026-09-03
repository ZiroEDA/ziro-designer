/**
 * Minimal dependency-free SigV4 client for R2's S3-compatible API.
 * Shared by the content uploaders (demos, libraries). Credentials come from
 * R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (+ R2_BUCKET).
 */
import { createHash, createHmac } from 'node:crypto';

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
export const BUCKET = process.env.R2_BUCKET ?? 'ziro-3dmodels';
if (!ACCOUNT || !KEY || !SECRET) {
  console.error(
    'Missing R2 credentials. Copy .env.example to .env, fill it in, and run this\n' +
      'through one of the root scripts (pnpm libraries:upload), which loads .env.\n' +
      '\n' +
      'These are R2 API tokens (an S3 key pair from R2 -> Manage API tokens), not\n' +
      'a Cloudflare API token: this client signs SigV4 against the S3 endpoint.\n' +
      '\n' +
      `  R2_ACCOUNT_ID        ${ACCOUNT ? 'ok' : 'missing'}\n` +
      `  R2_ACCESS_KEY_ID     ${KEY ? 'ok' : 'missing'}\n` +
      `  R2_SECRET_ACCESS_KEY ${SECRET ? 'ok' : 'missing'}`,
  );
  process.exit(1);
}
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const encPath = (p) =>
  p
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');

/**
 * PUT one object.
 *
 * `extra` carries response headers R2 stores with the object and replays on
 * every GET — `cache-control` and `content-encoding`. They are deliberately NOT
 * in `signedHeaders`: SigV4 requires only that every header it signs is sent,
 * not that every header sent is signed, and S3/R2 store these two either way.
 * Adding them to the canonical request would change nothing except give one
 * more thing to get wrong.
 *
 * Without them the bucket serves `index.json` raw, with an ETag and no
 * `Cache-Control` at all: 357 kB of symbol libraries and 649 kB of footprint
 * libraries downloaded again on every page load, gzip-free, when they compress
 * 4.4x and 7.8x.
 */
export async function putObject(key, body, contentType, extra = {}) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalUri = `/${BUCKET}/${encPath(key)}`;
  const headers = { host: HOST, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'PUT',
    canonicalUri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: auth,
      'content-type': contentType,
      'content-length': String(body.length),
      ...extra,
    },
    body,
  });
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`);
}

/** Fetch an object's body as text, or null when it is not there. */
export async function getObject(key) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${encPath(key)}`;
  const empty = sha256('');
  const headers = { host: HOST, 'x-amz-content-sha256': empty, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'GET',
    canonicalUri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    empty,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    headers: { ...headers, authorization: auth },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${key}: ${res.status} ${await res.text()}`);
  return await res.text();
}

/**
 * Fetch an object's body as BYTES, or null when it is not there.
 *
 * `getObject` decodes as text, which is right for manifests and wrong for
 * everything else: a PDF or a .bin round-tripped through UTF-8 comes back
 * corrupt, silently, because the replacement character is a valid decode.
 */
export async function getObjectBytes(key) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${encPath(key)}`;
  const empty = sha256('');
  const headers = { host: HOST, 'x-amz-content-sha256': empty, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'GET',
    canonicalUri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    empty,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    headers: { ...headers, authorization: auth },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${key}: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Remove an object. Used to prune probes and orphaned bundles. */
export async function deleteObject(key) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${encPath(key)}`;
  const empty = sha256('');
  const headers = { host: HOST, 'x-amz-content-sha256': empty, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [
    'DELETE',
    canonicalUri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signedHeaders,
    empty,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'DELETE',
    headers: { ...headers, authorization: auth },
  });
  // S3 delete is idempotent: a missing key is a 204, not an error.
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${key}: ${res.status}`);
}

/** Upload [key, body, type] entries with limited concurrency and retries. */
export async function uploadAll(entries, { concurrency = 8, onProgress } = {}) {
  let done = 0;
  const queue = [...entries];
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [key, body, type] = next;
      for (let attempt = 1; ; attempt++) {
        try {
          await putObject(key, body, type);
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
      done++;
      onProgress?.(done, entries.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}
