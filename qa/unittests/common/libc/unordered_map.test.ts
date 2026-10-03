// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * STD_UNORDERED_MAP against libstdc++ itself: every expectation is what
 * qa/probes/std_unordered_map_probe.cpp printed on this machine (regenerate with
 * qa/probes/std_unordered_map_gen.py).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STD_UNORDERED_MAP, hashString, hashWString } from '@ziroeda/common/libc/unordered_map.js';
import { describe, expect, it } from 'vitest';

interface Case {
  op: 'order' | 'erase' | 'clear';
  insert: string[];
  erase?: string[];
  after?: string[];
  order: string[];
  buckets: number;
}

const PROBE = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../data/common/libc/std_unordered_map_probe.json'),
    'utf8',
  ),
) as { hash: Record<string, string>; whash: Record<string, string>; cases: Case[] };

describe('std::hash<std::string>', () => {
  for (const [key, hash] of Object.entries(PROBE.hash)) {
    it(JSON.stringify(key), () => expect(hashString(key).toString()).toBe(hash));
  }
});

describe("std::hash<std::wstring>, wxString's hash", () => {
  for (const [key, hash] of Object.entries(PROBE.whash)) {
    it(JSON.stringify(key), () => expect(hashWString(key).toString()).toBe(hash));
  }
});

describe('std::unordered_map<std::string> iteration order', () => {
  it('has the cases, across the 13 / 29 / 59 bucket growths', () => {
    expect(new Set(PROBE.cases.map((c) => c.buckets))).toEqual(new Set([13, 29, 59, 127]));
  });

  for (const c of PROBE.cases) {
    it(`${c.op} of ${c.insert.length}`, () => {
      const map = new STD_UNORDERED_MAP<number>();

      c.insert.forEach((k, i) => map.emplace(k, i));

      if (c.op === 'erase') {
        for (const k of c.erase!) expect(map.erase(k)).toBe(true);
        c.after?.forEach((k, i) => map.emplace(k, i));
      }

      if (c.op === 'clear') {
        map.clear();
        c.after!.forEach((k, i) => map.emplace(k, i));
      }

      expect([...map.keys()]).toEqual(c.order);
      expect(map.bucket_count()).toBe(c.buckets);
      expect(map.size()).toBe(c.order.length);
    });
  }

  it('insert_or_assign gives an existing key its new value in its old place', () => {
    const map = new STD_UNORDERED_MAP<number>();
    for (const k of ['R', 'U', 'X-Y', 'C', 'J']) map.emplace(k, 0);
    const before = [...map.keys()];
    // The last key: re-inserting would put it at the front of the list.
    map.set(before[before.length - 1]!, 7);
    expect([...map.keys()]).toEqual(before);
    expect(map.get(before[before.length - 1]!)).toBe(7);
  });

  it('does not insert a key twice, and keeps the first value', () => {
    const map = new STD_UNORDERED_MAP<number>();
    expect(map.emplace('R', 1)).toBe(true);
    expect(map.emplace('R', 2)).toBe(false);
    expect(map.getOrInsert('R', () => 3)).toBe(1);
    expect(map.size()).toBe(1);
  });
});
