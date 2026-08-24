// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two things Akshay found in the Drawing Sheet Editor's right-hand side.
 *
 * The origin dropdown did not move the circle-and-X marker, and the Properties
 * palette had no sash. Both are source-shape checks because neither can be seen
 * from data: the first is a React dependency array, the second is a component
 * that either is or is not rendered. A test that imported the module and called
 * a function would pass in both the broken and the fixed tree.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');
const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');

describe('the coord-origin marker follows the dropdown', () => {
  it('draws the marker from the originIU prop, not from a constant', () => {
    // ds_painter.cpp:372-383 puts the circle and the X at GetMarkerPos(), which
    // PL_DRAW_PANEL_GAL sets from ReturnCoordOriginCorner().
    expect(CANVAS).toContain('const o = originIU ?? { x: 0, y: 0 };');
    expect(CANVAS).toContain('ctx.arc(o.x, o.y, r, 0, Math.PI * 2);');
  });

  it('lists originIU as a dependency of the draw callback', () => {
    // THE BUG. `draw` is a useCallback; an origin its closure never re-reads is
    // an origin the dropdown cannot move. The marker was painted once, at
    // whatever corner the frame opened on, and stayed there.
    const body = CANVAS.slice(CANVAS.indexOf('const draw = useCallback'));
    // The dependency array is the block that closes the callback: the first
    // `}, [` at the callback's own indentation after its body.
    const close = body.indexOf('\n    }, [');
    const arr = close >= 0 ? body.slice(close, body.indexOf(']);', close) + 3) : '';
    expect(arr, 'draw() dependency array').toContain('originIU');
  });

  it('and the editor actually passes it', () => {
    expect(EDITOR).toContain('originIU={originInfo.origin}');
  });
});

describe('the Properties palette has wxAUI’s sash', () => {
  it('renders the shared DockSash rather than a fixed strip', () => {
    // Every `.Palette()` pane upstream gets one for free, which is why no frame
    // writes one and why this one was missed: the pane was a fixed 150px.
    expect(EDITOR).toContain('<DockSash');
    expect(EDITOR).toContain("import { DockSash } from '../../ui/DockSash.js';");
  });

  it('puts it on the pane’s LEFT edge, between the toolbar and the palette', () => {
    // The right toolbar is Layer 2 and the palette Layer 3
    // (pl_editor_frame.cpp:196-204), so the palette is the outer of the two and
    // its sash lands between them — which is where Akshay said KiCad's is.
    const sash = EDITOR.slice(EDITOR.indexOf('<DockSash'));
    expect(sash.slice(0, sash.indexOf('/>'))).toContain('edge="left"');
  });

  it('drives the pane width from state, so a drag can change it', () => {
    // A sash wired to a constant would render and do nothing.
    expect(EDITOR).toContain('setPropsWidth(w);');
    expect(EDITOR).toContain('style={{ width: propsWidth, minWidth: propsWidth }}');
    expect(EDITOR).not.toContain('style={{ width: PROPERTIES_FRAME_WIDTH }}');
  });

  it('and the drag reaches properties_frame_width', () => {
    // `m_propertiesFrameWidth = m_propertiesPagelayout->GetSize().x`, then
    // `cfg->m_PropertiesFrameWidth = m_propertiesFrameWidth`
    // (pl_editor_frame.cpp:558-560). Without this the sash worked and forgot.
    const sash = EDITOR.slice(EDITOR.indexOf('<DockSash'));
    expect(sash.slice(0, sash.indexOf('/>'))).toContain('s.properties_frame_width = w');
  });

  it('takes its floor from the panel’s own content, as MinSize does', () => {
    // `MinSize( m_propertiesPagelayout->GetMinSize() )` is the panel's sizer
    // minimum, not a number someone chose.
    expect(EDITOR).toContain('el.scrollWidth');
    expect(EDITOR).toContain('setPropsMin(');
  });
});

describe('the pane opens at the width the settings declare', () => {
  it('is 150, the PARAM default, not the 200 in the constructor', () => {
    // pl_editor_settings.cpp:38,46 say 150; pl_editor_frame.cpp:97 initialises
    // the member to 200 and LoadSettings overwrites it at :538 before the pane
    // is built. Same trap as the units default, which was nearly "fixed" the
    // wrong way from the constructor.
    expect(PL_EDITOR_DEFAULTS.properties_frame_width).toBe(150);
  });

  it('opens at the STORED width, not at the default', () => {
    // `LoadSettings` reads it back at pl_editor_frame.cpp:538 and the pane is
    // built with it as `BestSize` at :204. Seeding the state from the constant
    // instead is exactly the bug this whole slice exists to remove.
    expect(EDITOR).toContain('useState(settings.plEditor.properties_frame_width)');
  });
});
