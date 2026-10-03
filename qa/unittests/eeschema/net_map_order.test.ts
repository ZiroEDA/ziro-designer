// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * CONNECTION_GRAPH's NET_MAP iterates as upstream's std::unordered_map<NET_NAME_CODE_CACHE_KEY>
 * does, with connection_graph.h's key hash. Expectations are what
 * qa/probes/std_unordered_map_probe.cpp's `netorder` printed (regenerate with
 * qa/probes/std_unordered_map_gen.py).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NET_MAP } from '@ziroeda/eeschema/connection_graph.js';
import { describe, expect, it } from 'vitest';

const PROBE = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/common/libc/std_unordered_map_probe.json'), 'utf8'),
) as { netorder: { insert: string[]; order: string[] }[] };

const key = (k: string) => {
  const at = k.lastIndexOf('@');
  return { Name: k.slice(0, at), Netcode: Number(k.slice(at + 1)) };
};

describe('NET_MAP iteration order', () => {
  it('has the cases', () => expect(PROBE.netorder.length).toBeGreaterThanOrEqual(6));

  for (const c of PROBE.netorder) {
    it(`${c.insert.length} keys`, () => {
      const map = new NET_MAP();

      // operator[], as connection_graph.cpp fills it; "--" is clear().
      for (const k of c.insert) {
        if (k === '--') map.clear();
        else map.at(key(k));
      }

      expect([...map].map(([k]) => `${k.Name}@${k.Netcode}`)).toEqual(c.order);
    });
  }
});
