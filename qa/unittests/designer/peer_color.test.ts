// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * peerColor.ts: the same peerId must always land on the same color, for
 * as long as that peer is connected, and different peerIds should
 * generally land on different colors (the whole point of the feature) —
 * see docs/proposals/pcb-multiplayer-sync.md, "peer colours".
 */
import { describe, expect, it } from 'vitest';
import { peerColor } from '@ziroeda/designer/src/sync/peerColor.js';

/** A large, deterministic, distinct-input sample (not `crypto.randomUUID()`):
 *  the palette-coverage checks below need to reliably visit every entry, not
 *  just probably visit most of them, and a fixed sequence makes that a
 *  certainty instead of a very likely outcome. */
const SAMPLE = Array.from({ length: 2000 }, (_, i) => `peer-${i}`);

describe('peerColor', () => {
  it('is deterministic: the same peerId always gets the same color', () => {
    const id = crypto.randomUUID();
    const first = peerColor(id);
    for (let i = 0; i < 20; i++) expect(peerColor(id)).toBe(first);
  });

  it('every color the palette actually hands out is a 6-digit hex color', () => {
    const seen = new Set(SAMPLE.map(peerColor));
    for (const c of seen) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('the palette is exactly these eight colors, the first being the old single REMOTE_CURSOR_COLOR', () => {
    // Pinned deliberately, the way a baseline is pinned elsewhere in this
    // suite: a real future palette change updates this test too, and in
    // the meantime it is what makes the mutation below meaningful rather
    // than a coin flip over which of 2000 samples happened to land badly.
    const seen = new Set(SAMPLE.map(peerColor));
    expect(seen).toEqual(
      new Set([
        '#e95420',
        '#5bc3eb',
        '#f76f8e',
        '#2accd9',
        '#9b8afb',
        '#8fd14f',
        '#f2c94c',
        '#c2986f',
      ]),
    );
  });

  it('spreads a realistic peer count across more than one color', () => {
    // Real peerIds are crypto.randomUUID() — this is the actual shape of
    // input the function has to distinguish well in practice, not the
    // synthetic sequence the exhaustive checks above use.
    const colors = new Set(Array.from({ length: 12 }, () => peerColor(crypto.randomUUID())));
    expect(colors.size).toBeGreaterThan(1);
  });
});
