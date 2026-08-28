// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a docked palette sits relative to the vertical toolbar beside it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, AND WHERE IT COMES FROM
 * ---------------------------------------------------------------------------
 *
 * KiCad docks every pane with wxAUI, and the half of that which is central is
 * `EDA_PANE` (`include/eda_base_frame.h:924-1010`), a `wxAuiPaneInfo` subclass
 * that fixes the DECORATION per pane kind: `VToolbar()` is caption-less,
 * dock-fixed and not movable; `Palette()` has a visible caption and a pane
 * border; `Canvas()` is `Layer( 0 )`. That is why a toolbar looks like a
 * toolbar in all eight launchers.
 *
 * The POSITION and LAYER are not central — each frame's constructor writes them
 * out, under the same comment in every one of them: "Rows; layers 4 - 6" and
 * "Columns; layers 1 - 3". In wxAUI a HIGHER layer docks FURTHER from the
 * centre, and the centre is the canvas. So the numbers are per-frame but the
 * ordering they produce is not, and it is the same everywhere:
 *
 *     on any one side, the vertical toolbar takes the LOWEST layer, so the
 *     toolbar always touches the canvas and every palette sits outside it.
 *
 *   pl_editor      RightToolbar Right L2, Props Right L3
 *                  (pl_editor_frame.cpp:197-204)
 *   eeschema       Left/RightToolbar L2; hierarchy Left L3 Pos 1;
 *                  Properties Left L3 Pos 2 (sch_edit_frame.cpp:259-288, and
 *                  the shared `defaultPropertiesPaneInfo`,
 *                  eeschema_settings.cpp:89-107)
 *   symbol editor  toolbars L2; LibraryTree Left L3
 *                  (symbol_edit_frame.cpp:208-222)
 *   pcbnew         Left/RightToolbar L3; LayersManager Right L4;
 *                  SelectionFilter Right L4 Pos 2; Properties Left L5
 *                  (pcb_edit_frame.cpp:338-392)
 *   fp editor      toolbars L2; Properties Left L3; Footprints tree Left L4;
 *                  LayersManager + SelectionFilter Right L3
 *                  (footprint_edit_frame.cpp:227-252)
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ASSERTED AS SOURCE ORDER
 * ---------------------------------------------------------------------------
 *
 * Each `.ze-body` is a flex row, so DOM order IS left-to-right order. qa's
 * tsconfig cannot compile `.tsx` and there is no DOM environment here (see
 * `ui_font_tokens.test.ts`), so the check is on the source text — the same
 * thing `menu_no_icons.test.ts` and `dialog_fit_size.test.ts` do.
 *
 * Every comparison asserts BOTH indices are found before comparing them. A
 * bare `indexOf(a) < indexOf(b)` passes when `a` was DELETED, because a missing
 * anchor returns -1 and -1 is less than everything: an ordering assertion that
 * survives the removal of the thing it orders is one of CLAUDE.md's four
 * shapes of test that cannot fail. That exact bug shipped on this branch once
 * already, in `revert.test.ts`.
 *
 * The widths are here too, because they are the same finding: a pane's size in
 * KiCad is `.BestSize(...)` floored by `.MinSize(...)`, and both of those are
 * either a number upstream states or the panel's own content. A width picked at
 * the call site is neither.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FPEDIT_DEFAULTS, PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SRC = '../../../designer/src/';
const DS = read(`${SRC}editors/drawingsheet/DrawingSheetEditor.tsx`);
const SCH = read(`${SRC}editors/schematic/SchematicEditor.tsx`);
const PCB = read(`${SRC}editors/pcb/PcbEditor.tsx`);
const SYM = read(`${SRC}editors/symbol/SymbolEditor.tsx`);
const FP = read(`${SRC}editors/footprint/FootprintEditor.tsx`);
const SHELL = read(`${SRC}ui/shell.css`);

/**
 * `a` appears before `b` in `src`, having first established that both are
 * there at all. Without the two existence checks a deleted anchor scores -1
 * and the ordering passes vacuously.
 */
function before(src: string, a: string, b: string, what: string): void {
  const ia = src.indexOf(a);
  const ib = src.indexOf(b);
  expect(ia, `${what}: "${a}" is not in the source at all`).toBeGreaterThanOrEqual(0);
  expect(ib, `${what}: "${b}" is not in the source at all`).toBeGreaterThanOrEqual(0);
  expect(ia, `${what}: expected "${a}" before "${b}"`).toBeLessThan(ib);
}

describe('a vertical toolbar touches the canvas; a palette docks outside it', () => {
  it('pl_editor: canvas, then RightToolbar L2, then Props L3', () => {
    // `<DrawingSheetCanvas` alone also matches inside
    // `useRef<DrawingSheetCanvasController>`, so anchor on the JSX open tag.
    const canvas = '<DrawingSheetCanvas\n';
    before(DS, 'entries={dsLeftBar}', canvas, 'pl_editor left');
    before(DS, canvas, 'entries={dsRightBar}', 'pl_editor canvas');
    // The one this branch fixed: Props used to render between the canvas and
    // the toolbar, i.e. as though it were Layer 1.
    before(DS, 'entries={dsRightBar}', 'className="ze-leftdock on-right"', 'pl_editor right');
  });

  it('footprint editor: Footprints tree L4 and Properties L3 outside LeftToolbar L2', () => {
    before(
      FP,
      'className="ze-leftdock" style={{ width: panelWidth',
      'entries={FP_LEFT_TOOLBAR}',
      'fp left',
    );
  });

  it('footprint editor: LayersManager + SelectionFilter L3 outside RightToolbar L2', () => {
    // The second one this branch fixed, and it is why the rule is asserted per
    // launcher rather than once: pl_editor and the footprint editor had the
    // same bug, and three other launchers did not.
    //
    // The dock is `.ze-rightdock`, the same construct pcbnew uses, since
    // `footprint_edit_frame.cpp:243-254` docks LayersManager and SelectionFilter
    // exactly the way `pcb_edit_frame.cpp:345-365` does: two panes in one
    // `.Right().Layer( 3 )` stack, the filter at `.Position( 2 )`. It used to be
    // the LEFT dock rule with the border flipped over, which is why the filter
    // pane could not be stacked under it at all.
    before(FP, 'entries={FP_RIGHT_TOOLBAR}', 'className="ze-rightdock"', 'fp right');
    before(FP, 'className="ze-rightdock"', 'ze-panel-header">Appearance', 'fp appearance');
    before(FP, 'ze-panel-header">Appearance', 'ze-panel-header">Selection Filter', 'fp filter');
  });

  it('symbol editor: LibraryTree L3 outside LeftToolbar L2', () => {
    before(SYM, 'className="ze-leftdock"', 'entries={SYM_LEFT_TOOLBAR}', 'symbol left');
  });

  it('eeschema: the Properties / Hierarchy column L3 outside LeftToolbar L2', () => {
    before(SCH, 'className="ze-leftdock sch-leftdock"', 'entries={schLeftBar}', 'sch left');
  });

  it('pcbnew: Properties L5 outside LeftToolbar L3, LayersManager L4 outside RightToolbar L3', () => {
    before(PCB, 'className="ze-leftdock"', 'entries={pcbLeftBar}', 'pcb left');
    before(PCB, 'entries={pcbRightBar}', 'className="ze-rightdock"', 'pcb right');
  });
});

describe('the right-hand dock column carries its separator on the canvas side', () => {
  const at = SHELL.indexOf('.ze-leftdock.on-right {');
  const body = SHELL.slice(at, SHELL.indexOf('}', at));

  it('exists, because a dock on the right is not `.ze-rightdock`', () => {
    // `.ze-rightdock` is pcbnew's Appearance + Selection Filter stack and
    // repaints its panes in `--panel-list-bg`, which a plain wxPanel does not
    // have. Reusing it for pl_editor's Props pane would have recoloured it.
    expect(at).toBeGreaterThanOrEqual(0);
  });

  it('moves the border to the left edge, since that is the edge facing the canvas', () => {
    expect(body).toMatch(/border-right:\s*none/);
    expect(body).toMatch(/border-left:\s*1px solid var\(--chrome-border\)/);
  });

  it('floors the pane at its content, which is what `.MinSize` does', () => {
    // `.MinSize( m_propertiesPagelayout->GetMinSize() )`,
    // pl_editor_frame.cpp:203 — wxAUI shows whichever of MinSize and BestSize
    // is larger, so the width is really the panel's own content.
    expect(body).toMatch(/min-width:\s*min-content/);
  });
});

describe('a docked pane is sized by the numbers upstream states, not at the call site', () => {
  it('pl_editor Props starts at properties_frame_width, which is 150', () => {
    // PL_EDITOR_SETTINGS `properties_frame_width` (pl_editor_settings.cpp:46).
    // The 200 at pl_editor_frame.cpp:97 is the ctor's seed and LoadSettings
    // overwrites it from the setting at :538.
    //
    // The 150 is no longer written in the editor at all: it is that
    // parameter's default and it lives in the settings file's defaults, which
    // is the "upstream number, not the call site" this whole block is about.
    expect(PL_EDITOR_DEFAULTS.properties_frame_width).toBe(150);
    expect(DS).toContain('PROPERTIES_FRAME_WIDTH = PL_EDITOR_DEFAULTS.properties_frame_width');
    // The pane is now draggable — wxAUI gives every `.Palette()` one a sash —
    // and the width it opens at is the STORED one, the default only standing in
    // for a profile that has never dragged it. The sash itself is pinned in
    // `ds_origin_and_sash.test.ts`.
    expect(DS).toContain('useState(settings.plEditor.properties_frame_width)');
    expect(DS).toContain('style={{ width: propsWidth, minWidth: propsWidth }}');
    // The number it replaced. 272 is nowhere in pl_editor.
    expect(DS).not.toContain('width: 272');
  });

  it('the two library trees start at 250, the number both frames state', () => {
    // symbol_edit_frame.cpp:219-222 and footprint_edit_frame.cpp:228-231 both
    // say `.MinSize( FromDIP( 250 ), … ).BestSize( FromDIP( 250 ), -1 )`.
    expect(SYM).toMatch(/const LIBRARY_TREE_WIDTH = 250;/);
    expect(FP).toMatch(/const LIBRARY_TREE_WIDTH = 250;/);
    expect(SYM).toContain('useState(LIBRARY_TREE_WIDTH)');
    // The Footprint Editor's pane is a PERSISTED width now —
    // `PARAM<int>( "window.lib_width", &m_LibWidth, 250 )`
    // (footprint_editor_settings.cpp:69-70), restored with `SetAuiPaneSize` at
    // :279-280 — so it opens at the stored number and the constant is only the
    // fallback for a profile that has never dragged it. The same shape the
    // pl_editor Props pane above took, and the 250 is still upstream's, stated
    // once in the settings defaults.
    expect(FPEDIT_DEFAULTS.window.lib_width).toBe(250);
    expect(FP).toContain('settings.fpEdit.window.lib_width || LIBRARY_TREE_WIDTH');
    // Both were 260, which is neither frame's number.
    expect(SYM).not.toContain('useState(260)');
    expect(FP).not.toContain('useState(260)');
  });

  it('the footprint editor LayersManager starts at 180, not 200', () => {
    // footprint_edit_frame.cpp:243-252: `.MinSize( FromDIP( 180 ), FromDIP( 80 ) )
    // .BestSize( FromDIP( 180 ), -1 )`, shared with the Selection Filter below it.
    expect(FP).toMatch(/const LAYERS_MANAGER_WIDTH = 180;/);
    expect(FP).toContain('style={{ width: LAYERS_MANAGER_WIDTH }}');
    expect(FP).not.toContain('style={{ width: 200 }}');
  });
});
