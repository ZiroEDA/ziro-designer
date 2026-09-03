/**
 * A minimal ZIP writer, for bundling one demo project into one object.
 *
 * `upload.mjs` is deliberately dependency-free (it hand-rolls SigV4 rather than
 * carry an S3 SDK), so this uses node's own zlib rather than pulling fflate
 * into tools/. The output is read back by `expandArchive`
 * (designer/src/home/project_archiver.ts), which is fflate's `unzipSync` — the
 * same function that already opens a user's uploaded .zip, so a demo bundle
 * needs no new unpacking code in the app at all.
 *
 * Deliberately plain: deflate, no zip64, no encryption, no data descriptors.
 * A demo project is a few tens of MB and a few hundred entries, far inside
 * every 32-bit field here.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * DOS date/time. Fixed rather than "now": the bundle is content, and stamping
 * it with the build clock makes every rebuild a different object even when
 * nothing in the project changed. 1980-01-01 is the epoch of the format.
 */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // January 1, year 0 of the DOS epoch (1980)

/**
 * @param {Record<string, Uint8Array>} entries path -> bytes
 * @param {{ store?: boolean }} [opts] `store` writes every entry uncompressed.
 *
 * Storing looks wasteful and is not, when the object is then served with
 * `content-encoding: br`: deflate compresses each file in isolation, while
 * brotli over the whole archive sees the redundancy BETWEEN files — and a
 * KiCad project is dozens of near-identical `.kicad_mod` footprints. Measured
 * on CM5 Minima: 10,674,284 bytes deflated per-file against 7,194,221 bytes
 * stored-then-brotli, a 32.6% saving for the same content.
 *
 * @returns {Buffer} the .zip
 */
export function zipSync(entries, opts = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, bytes] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(bytes);
    const deflated = opts.store ? body : deflateRawSync(body, { level: 9 });
    // A file that deflates larger than it started (already-compressed bytes:
    // a PDF, a PNG) is stored instead, which is what every real zip writer
    // does and what keeps a bundle from being bigger than its contents.
    const stored = opts.store || deflated.length >= body.length;
    const data = stored ? body : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(body);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x800, 6); // UTF-8 names; real projects have non-ASCII
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(body.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); // extra
    cen.writeUInt16LE(0, 32); // comment
    cen.writeUInt16LE(0, 34); // disk
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // disk with CD
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, cd, end]);
}

/**
 * Re-read a zip we just wrote, from its bytes, and prove it round-trips.
 *
 * The app reads these with fflate, which `tools/` cannot resolve (this file
 * exists precisely because `upload.mjs` carries no dependencies), so nothing in
 * CI opens a bundle this writer produced. A corrupt bundle would upload
 * happily and fail for every user at once, so it is checked here instead —
 * before the object is sent, not after.
 *
 * The parse deliberately starts from the end-of-central-directory record and
 * follows the stored offsets, rather than trusting anything `zipSync` held in
 * memory: offsets, sizes and CRCs are exactly what a hand-rolled container
 * gets wrong, and re-deriving them from the buffer is what makes this a test
 * rather than a restatement.
 *
 * @param {Buffer} buf
 * @param {Record<string, Uint8Array>} expected
 */
export function verifyZip(buf, expected) {
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error('zip: no end-of-central-directory');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);

  const names = Object.keys(expected);
  if (count !== names.length) throw new Error(`zip: ${count} entries, expected ${names.length}`);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('zip: bad central header');
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compSize = buf.readUInt32LE(at + 20);
    const rawSize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);

    const want = expected[name];
    if (!want) throw new Error(`zip: entry not in the source set: ${JSON.stringify(name)}`);

    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`zip: bad local header: ${name}`);
    const lNameLen = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataAt, dataAt + compSize);
    const body = method === 0 ? data : inflateRawSync(data);

    if (body.length !== rawSize) throw new Error(`zip: size mismatch: ${name}`);
    if (crc32(body) !== crc) throw new Error(`zip: crc mismatch: ${name}`);
    if (Buffer.compare(body, Buffer.from(want)) !== 0)
      throw new Error(`zip: content mismatch: ${name}`);

    at += 46 + nameLen + extraLen + commentLen;
  }
}
