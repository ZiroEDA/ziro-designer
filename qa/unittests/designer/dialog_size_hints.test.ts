// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A dialog only ever grows.
 *
 * `bMainSizer->Fit( this )` then `GetSizer()->SetSizeHints( this )`: size to
 * the content once, and never go below that again. `.ze-modal` ports the first
 * half as `width: max-content`, which is right at construction and wrong for
 * the rest of the dialog's life -- CSS does not do anything once, so it tracks
 * the content and the window jumps whenever the content changes. This is the
 * decision that replaces it: `wxSize::IncTo`, a componentwise maximum.
 */
import { describe, expect, it } from 'vitest';
import { heldSize } from '@ziroeda/designer/src/ui/dialog_size_hints.js';

describe('the size a dialog holds', () => {
  it('takes the larger of what it had and what it now needs', () => {
    expect(heldSize({ w: 0, h: 0 }, { w: 420, h: 300 })).toEqual({ w: 420, h: 300 });
    expect(heldSize({ w: 420, h: 300 }, { w: 480, h: 280 })).toEqual({ w: 480, h: 300 });
  });

  it('ignores a smaller measurement, which is the whole point', () => {
    // The bug this exists to remove: picking a radio whose explanation is a
    // line shorter used to narrow the dialog under the user. Upstream calls
    // `Fit()` at construction and never again, so it cannot happen there.
    expect(heldSize({ w: 480, h: 300 }, { w: 300, h: 120 })).toEqual({ w: 480, h: 300 });
  });

  it('ignores an unmeasured element rather than treating it as zero', () => {
    // A dialog not yet laid out, or `display: none`, reports 0 for both.
    // Clamping the floor down to that would put the tracking behaviour back
    // while looking like it was working — the floor would be re-derived from
    // whatever the content happened to be each time.
    expect(heldSize({ w: 480, h: 300 }, { w: 0, h: 0 })).toEqual({ w: 480, h: 300 });
    expect(heldSize({ w: 480, h: 300 }, { w: 0, h: 340 })).toEqual({ w: 480, h: 340 });
  });
});
