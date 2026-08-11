/** Signed GETs to confirm library objects landed on R2 (the pub-*.r2.dev host
 * is blocked from this container, so verify via the S3 endpoint). */
import { createHash, createHmac } from 'node:crypto';

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET ?? 'ziro-3dmodels';
if (!ACCOUNT || !KEY || !SECRET) {
  // Without this the missing credentials surface as a signature mismatch from
  // the S3 endpoint, which reads like a broken uploader rather than an empty
  // .env. See .env.example; `pnpm libraries:verify` loads it.
  console.error('Missing R2 credentials. Copy .env.example to .env, then: pnpm libraries:verify');
  process.exit(1);
}
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const EMPTY = sha256('');

async function get(key) {
  const amzDate = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const date = amzDate.slice(0, 8);
  const uri = `/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { host: HOST, 'x-amz-content-sha256': EMPTY, 'x-amz-date': amzDate };
  const signed = Object.keys(headers).sort().join(';');
  const canonical = [
    'GET',
    uri,
    '',
    ...Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}`),
    '',
    signed,
    EMPTY,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSig = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), 'auto'), 's3'), 'aws4_request');
  const sig = createHmac('sha256', kSig).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signed}, Signature=${sig}`;
  const res = await fetch(`https://${HOST}${uri}`, {
    headers: { ...headers, authorization: auth },
  });
  const text = await res.text();
  return { status: res.status, len: text.length, body: text };
}

const symIdx = await get('symbols/index.json');
const symIdxJson = JSON.parse(symIdx.body);
const fpIdx = await get('footprints/index.json');
const fpIdxJson = JSON.parse(fpIdx.body);
const device = await get('symbols/Device.kicad_sym');
const r0805 = await get('footprints/Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod');

console.log(`symbols/index.json      ${symIdx.status}  ${symIdxJson.length} libraries`);
console.log(`footprints/index.json   ${fpIdx.status}  ${fpIdxJson.length} libraries`);
console.log(
  `symbols/Device.kicad_sym            ${device.status}  ${device.len} chars  starts:(${device.body.slice(1, 17)}`,
);
console.log(
  `footprints/.../R_0805_2012Metric    ${r0805.status}  ${r0805.len} chars  starts:(${r0805.body.slice(1, 17)}`,
);
const ok =
  [symIdx, fpIdx, device, r0805].every((r) => r.status === 200) &&
  device.len > 100 &&
  r0805.len > 100;
console.log(ok ? 'VERIFIED' : 'FAILED');
process.exit(ok ? 0 : 1);
