// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `shortest` — fmt's `{}` for a double, which `bitmap2component.cpp` writes a
 * footprint's `(xy {} {})` with.
 *
 * THE EXPECTATIONS ARE NOT DERIVED FROM OUR CODE: each is what
 * `qa/probes/fmt_shortest_probe.cpp` printed, compiled against KiCad 10.0.5's
 * own vendored fmt 12.1.0 on this machine.
 */
import { describe, expect, it } from 'vitest';
import { shortest } from '@ziroeda/common/plotters/fmt.js';

const PROBE: [number, string][] = [
  [0.0, '0'],
  [-0.0, '-0'],
  [1.0, '1'],
  [-0.5, '-0.5'],
  [0.931333, '0.931333'],
  [-0.931334, '-0.931334'],
  [0.0001, '0.0001'],
  [0.00001, '1e-05'],
  [1.5e-5, '1.5e-05'],
  [-2.5e-7, '-2.5e-07'],
  [1e15, '1000000000000000'],
  [1e16, '1e+16'],
  [1.5e16, '1.5e+16'],
  [123.456, '123.456'],
  [0.1 + 0.2, '0.30000000000000004'],
  [1e-4 * 3, '0.00030000000000000003'],
  [5e-324, '5e-324'],
  [1.7976931348623157e308, '1.7976931348623157e+308'],
  [1234567.0, '1234567'],
  [0.508, '0.508'],
  [-0.000508, '-0.000508'],
];

describe("fmt's {} for a double", () => {
  for (const [v, text] of PROBE) {
    it(`${text}`, () => {
      expect(shortest(v)).toBe(text);
    });
  }
});
