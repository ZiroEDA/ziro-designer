// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The dock sash grows the pane the way wxAUI does, per edge.
 *
 * wxAUI puts a sash between every docked pane and the centre one, which is why
 * KiCad's layers managers and properties panels are all draggable without any
 * frame asking for it. We had the behaviour hand-written per editor, so the
 * direction was restated at each site - and a restated direction is one that
 * can disagree with itself. These are the three things that go wrong: the
 * sign, the pane's own MinSize, and a window too narrow for both.
 */
import { describe, expect, it } from 'vitest';
import { dockedPaneWidth, resizeDock } from '@ziroeda/designer/src/ui/dock_sash.js';

describe('resizeDock', () => {
  it('grows a right-docked pane when the pointer moves left', () => {
    // GerbView's layers manager: Right().Layer( 3 ), so its sash is on the
    // pane's left edge and a leftward drag makes it wider.
    expect(resizeDock('left', 240, -60, 80, 1000)).toBe(300);
    expect(resizeDock('left', 240, +60, 80, 1000)).toBe(180);
  });

  it('grows a left-docked pane when the pointer moves right', () => {
    // The Properties panel's sash is on its right edge; the sign flips.
    expect(resizeDock('right', 300, +60, 240, 1000)).toBe(360);
    expect(resizeDock('right', 300, -60, 240, 1000)).toBe(240);
  });

  it("stops at the pane's MinSize", () => {
    // GERBVIEW_FRAME asks for MinSize( FromDIP( 80 ), FromDIP( 80 ) )
    // (`gerbview/gerbview_frame.cpp:171`), so 80 is where the drag stops -
    // not zero, and not a number of ours.
    expect(resizeDock('left', 240, +10000, 80, 1000)).toBe(80);
    expect(resizeDock('right', 300, -10000, 240, 1000)).toBe(240);
  });

  it('stops where the centre pane would be squeezed out', () => {
    expect(resizeDock('left', 240, -10000, 80, 500)).toBe(500);
  });

  it('keeps MinSize when the window is too narrow to honour both', () => {
    // A cap below the pane's own minimum is not a cap: wxAUI will not shrink a
    // pane past MinSize to make room, it lets the centre pane lose instead.
    // Clamping naively the other way round returns the *cap*, so the pane
    // silently drops under its minimum on a narrow window.
    expect(resizeDock('left', 240, -10000, 200, 50)).toBe(200);
    expect(resizeDock('left', 240, +10000, 200, 50)).toBe(200);
  });
});

describe('dockedPaneWidth', () => {
  it('opens at the MinSize when the content is wider than the BestSize', () => {
    // pl_editor's properties pane: `properties_frame_width` is 150
    // (pl_editor_settings.cpp:38) but the panel's own GetMinSize() is wider,
    // and pl_editor_frame.cpp:200-204 hands wxAUI both. Taking the settings
    // default alone opened the pane at 150 and clipped the value column, the
    // vertical-justify buttons and the text-colour swatch.
    expect(dockedPaneWidth(150, 274)).toBe(274);
  });

  it('keeps the BestSize when the content fits inside it', () => {
    // The other order has to hold too, or the pane would shrink to its
    // content and ignore the width the frame asked for.
    expect(dockedPaneWidth(300, 274)).toBe(300);
  });
});
