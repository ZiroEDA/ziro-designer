// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIUI::EnsureTextCtrlWidth`, whose whole behaviour is that it only grows.
 *
 * `common/widgets/ui_common.cpp:174-198` raises the control's minimum when a
 * string does not fit and does nothing at all when it does. Nothing lowers it
 * again, so a box that once held a long string keeps its width afterwards —
 * which is the half a call site gets wrong by recomputing the width from
 * whatever text is there now.
 */
import { describe, expect, it } from 'vitest';
import { ensureTextCtrlWidth } from '@ziroeda/designer/src/ui/text_ctrl_width.js';

describe('the control grows to fit', () => {
  it('takes the text plus ten when the text does not fit', () => {
    // `ctrlz.SetWidth( textz.GetWidth() + 10 )`.
    expect(ensureTextCtrlWidth(98, 157)).toBe(167);
  });

  it('leaves the width alone when the text already fits', () => {
    // The `if` is `ctrlz < textz + 10`, so a string that fits changes nothing.
    expect(ensureTextCtrlWidth(200, 157)).toBe(200);
  });

  it('is exact at the boundary, where the text plus ten is the width', () => {
    // 167 is not less than 167, so nothing happens — off by one here would
    // widen the control by ten pixels every time the same string was set.
    expect(ensureTextCtrlWidth(167, 157)).toBe(167);
    expect(ensureTextCtrlWidth(166, 157)).toBe(167);
  });
});

describe('the control never shrinks, which is the whole point', () => {
  it('keeps a width a longer string won', () => {
    const wide = ensureTextCtrlWidth(98, 157);
    expect(ensureTextCtrlWidth(wide, 20)).toBe(wide);
  });

  it('keeps it even for the empty string', () => {
    // GerbView clears the box back to "" when a layer goes away. Upstream's
    // box stays as wide as it was; a recompute would snap it back to the
    // default and the toolbar would jump.
    const wide = ensureTextCtrlWidth(98, 157);
    expect(ensureTextCtrlWidth(wide, 0)).toBe(wide);
  });

  it('is monotonic over a run of different strings', () => {
    // Feed it a sequence and the width may only ever climb.
    let w = 98;
    const seen: number[] = [];
    for (const text of [40, 157, 12, 200, 0, 60]) {
      w = ensureTextCtrlWidth(w, text);
      seen.push(w);
    }
    expect(seen).toStrictEqual([98, 167, 167, 210, 210, 210]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });
});
