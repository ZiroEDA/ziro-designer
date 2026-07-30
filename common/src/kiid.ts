/**
 * KIID helpers. Counterpart: `common/kiid.cpp`.
 *
 * Only the deterministic name-to-UUID mapping is ported: KIID::FromName hashes a
 * name into a version-5 (SHA-1) UUID under a fixed namespace, so the same name
 * always yields the same identifier. The netlist reader uses it to collapse a
 * group's instance path into the UUID of the board group that mirrors it, which
 * is what lets a re-run of "Update PCB from Schematic" find the group it made
 * last time instead of creating a second one.
 */

/** KIID::FromName's namespace UUID, fixed forever (kiid.cpp). */
const NAMESPACE_UUID = '8b8b58e2-3d21-4a24-9dcf-42e0f14001a2';

/** SHA-1 (FIPS 180-4), synchronous: WebCrypto's digest is promise-only. */
function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length * 8;
  // Pad to a multiple of 64 bytes: 0x80, zeros, then the 64-bit big-endian length.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(ml / 0x100000000));
  view.setUint32(padded.length - 4, ml >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));

  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(block + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setInt32(0, h0);
  ov.setInt32(4, h1);
  ov.setInt32(8, h2);
  ov.setInt32(12, h3);
  ov.setInt32(16, h4);
  return out;
}

/** "8b8b58e2-3d21-…" -> its 16 bytes. */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/**
 * KIID::FromName, the version-5 UUID of `name` in KiCad's fixed namespace
 * (boost::uuids::name_generator_sha1, which is RFC 4122 §4.3).
 */
export function kiidFromName(name: string): string {
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(uuidToBytes(NAMESPACE_UUID));
  input.set(nameBytes, 16);

  const digest = sha1(input);
  const b = digest.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const s = [...b].map(hex2).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** KIID_PATH::AsString, "/uuid/uuid", or "/" for the root path. */
export function kiidPathAsString(uuids: readonly string[]): string {
  return uuids.length === 0 ? '/' : `/${uuids.join('/')}`;
}
