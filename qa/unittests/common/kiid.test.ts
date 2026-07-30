// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KIID::FromName, the deterministic name -> UUID mapping the netlist reader uses
 * to turn a group's instance path into a stable board-group UUID. Checked against
 * Node's SHA-1, so the port cannot drift from RFC 4122 §4.3 (and so from boost's
 * name_generator_sha1, which is what upstream uses).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { kiidFromName, kiidPathAsString } from '@ziroeda/common';

/** KiCad's fixed namespace (common/kiid.cpp). */
const NS = '8b8b58e2-3d21-4a24-9dcf-42e0f14001a2';

function referenceUuid5(name: string): string {
  const ns = Buffer.from(NS.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const s = b.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

describe('kiidFromName', () => {
  // Lengths that straddle the SHA-1 block boundary (55/56/57 bytes + namespace)
  // are the ones a hand-rolled padding gets wrong.
  const names = [
    '',
    '/',
    '/abc/',
    '/f1b49c40-0000-4000-8000-000000000001/7b1488be-0000-4000-8000-000000000002',
    'x'.repeat(39),
    'y'.repeat(40),
    'z'.repeat(41),
    'w'.repeat(103),
    'v'.repeat(104),
    'u'.repeat(1000),
    'ünïcödé-π',
  ];

  it.each(names)('matches RFC 4122 v5 for %j', (name) => {
    expect(kiidFromName(name)).toBe(referenceUuid5(name));
  });

  it('is stable across calls', () => {
    expect(kiidFromName('/abc/')).toBe(kiidFromName('/abc/'));
  });

  it('formats KIID_PATHs like KIID_PATH::AsString', () => {
    expect(kiidPathAsString([])).toBe('/');
    expect(kiidPathAsString(['a'])).toBe('/a');
    expect(kiidPathAsString(['a', 'b'])).toBe('/a/b');
  });
});
