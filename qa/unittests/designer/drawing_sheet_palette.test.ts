// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor has to LOOK like `pl_editor`.
 *
 * The audit's verdict was that at a glance the two apps did not read as the
 * same program, and every reason was a colour or a size we had invented:
 * a dark backdrop with a white page and a drop shadow where pl_editor paints
 * one flat colour with the page as an outline, a pink-red sheet where KiCad's
 * is maroon, #2c2c2c chrome where GTK gives a docked pane #373737, and mm
 * where the frame opens in mils.
 *
 * WHAT THIS FILE CANNOT DO: it cannot look at a pixel. These tests run in
 * node, there is no DOM test environment in this repo, and jsdom does no
 * layout - `getBoundingClientRect()` returns 0 for every box and a 2D context
 * does not exist. So the rendered result is verified by hand against a live
 * pl_editor and the numbers live in the PR; what is asserted here is
 * everything a text-reading test genuinely can see: the exported colour
 * values, that they are the same three COLOR_SETTINGS layers the schematic
 * theme already transcribes, which paint calls the canvas makes, and the
 * declarations in the scoped CSS rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DS_ITEM_COLOR,
  DS_BG_COLOR,
  DS_BRIGHTENED_COLOR,
  DS_EDIT_POINT_ON_DARK,
  DS_EDIT_POINT_ON_LIGHT,
  DS_MARQUEE,
  DS_PAGE_BORDER_COLOR,
  DS_PRINT_PAPER_COLOR,
  DS_SELECTED_COLOR,
} from '@ziroeda/common';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  FRAME_TITLE_SEPARATOR,
  frameTitleName,
} from '@ziroeda/designer/src/ui/useDocumentTitle.js';
import { PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { togglesFromSettings } from '@ziroeda/designer/src/editors/drawingsheet/toggles.js';
import { DEFAULT_GRID_INDEX, GRID_SIZE_LIST } from '@ziroeda/designer/src/ui/grid_settings.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');
const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');
const SHELL = read('../../../designer/src/ui/shell.css');

/** The stylesheet with its comments taken out, so they cannot read as values. */
const CSS_CODE = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `:root` tokens, as a name -> value map. */
const TOKENS: Record<string, string> = (() => {
  const at = SHELL.indexOf(':root {');
  expect(at, 'shell.css has no :root block').toBeGreaterThanOrEqual(0);
  const body = SHELL.slice(at, SHELL.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
})();

/** The declarations of one rule, as a property -> value map. */
function rule(selector: string): Record<string, string> {
  const at = CSS_CODE.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = CSS_CODE.slice(at + selector.length + 4, CSS_CODE.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return out;
}

describe('D1/D2/D3: the palette is the three layers DS_RENDER_SETTINGS reads', () => {
  // ds_painter.cpp:69-80 (DS_RENDER_SETTINGS::LoadColors) takes exactly three
  // colours; the values are s_defaultTheme, builtin_color_themes.h:32/46/78.
  it('background is LAYER_SCHEMATIC_BACKGROUND, rgb(245, 244, 239)', () => {
    expect(DS_BG_COLOR).toBe('rgb(245, 244, 239)');
  });

  it('the page outline is LAYER_SCHEMATIC_GRID, rgb(181, 181, 181)', () => {
    expect(DS_PAGE_BORDER_COLOR).toBe('rgb(181, 181, 181)');
  });

  it('sheet items are LAYER_SCHEMATIC_DRAWINGSHEET, rgb(132, 0, 0)', () => {
    expect(DS_ITEM_COLOR).toBe('rgb(132, 0, 0)');
  });

  // The one assertion here that is not a literal: s_defaultTheme is
  // transcribed twice in this repo, and these are the same three entries. If
  // either copy drifts, this fails and names which layer moved.
  it('agrees with the schematic theme, which transcribes the same table', () => {
    expect(DS_BG_COLOR).toBe(KICAD_DEFAULT.background); // LAYER_SCHEMATIC_BACKGROUND
    expect(DS_PAGE_BORDER_COLOR).toBe(KICAD_DEFAULT.grid); // LAYER_SCHEMATIC_GRID
    expect(DS_ITEM_COLOR).toBe(KICAD_DEFAULT.pageFrame); // LAYER_SCHEMATIC_DRAWINGSHEET
  });

  it('keeps a separate white for print, which carries no screen theme', () => {
    expect(DS_PRINT_PAPER_COLOR).toBe('#ffffff');
    expect(EDITOR).toContain('ctx.fillStyle = DS_PRINT_PAPER_COLOR;');
  });
});

describe('D1: the canvas is one flat colour and the page is an outline', () => {
  it('clears the whole canvas to the background, as draw_panel_gal.cpp:364 does', () => {
    expect(CANVAS).toContain('ctx.fillStyle = background;');
    expect(CANVAS).toContain('ctx.fillRect(0, 0, canvas.width, canvas.height);');
  });

  it('paints no paper rectangle over it', () => {
    // ds_painter.cpp:357-382 sets SetIsFill( false ): there is no page fill
    // anywhere in pl_editor, which is why the canvas and the paper match.
    expect(CANVAS).not.toContain('DS_PAGE_COLOR');
    expect(CANVAS).not.toMatch(/fillRect\(0, 0, pageW, pageH\)/);
  });

  it('paints no drop shadow', () => {
    expect(CANVAS).not.toContain('rgba(0,0,0,0.35)');
    expect(CANVAS).not.toContain('shadowBlur');
    expect(CANVAS).not.toContain('shadowColor');
  });

  it('strokes the page rectangle in the border colour instead', () => {
    // `m_pageBorderColor`, which is now READ off the chosen theme rather than
    // named as a module constant — `ds_canvas_color_theme.test.tsx` renders the
    // canvas and asserts the colour that comes out. What is checked here is the
    // shape of the call: a stroke, no fill, one device pixel wide.
    expect(CANVAS).toContain('ctx.strokeStyle = colors.pageBorder;');
    // One device pixel: GetDefaultPenWidth() renders as a hairline at any zoom,
    // and `worldPen` is 1 device px expressed in world units.
    const stroke = CANVAS.indexOf('ctx.strokeStyle = colors.pageBorder;');
    expect(CANVAS.slice(stroke, stroke + 200)).toContain('ctx.lineWidth = worldPen;');
    // The rect is stroked in DEVICE space, from the page corners transformed by
    // hand, so the hairline lands on a pixel centre instead of straddling two —
    // it used to be `ctx.strokeRect(0, 0, pageW, pageH)` under the world
    // transform and read as a soft grey border. Still a stroke, still no fill;
    // only where the coordinates come from changed.
    const after = CANVAS.slice(stroke, stroke + 900);
    expect(after).toContain('ctx.setTransform(1, 0, 0, 1, 0, 0);');
    expect(after).toMatch(/ctx\.strokeRect\(l, t, r - l, b - t\)/);
    expect(after).toContain('m.a * pageW + m.e');
    expect(after).toContain('m.d * pageH + m.f');
  });
});

describe('D5/D6: the drawing-sheet chrome sits on the frame face', () => {
  it('has the frame-background token at the #373737 that was measured', () => {
    expect(TOKENS['--content-bg']).toBe('#373737');
  });

  it('puts the toolbars and the message panel on it, not on the chrome grey', () => {
    // The toolbar half is no longer scoped to this frame: GerbView was measured
    // as the second frame this block asked for and reads the same #373737, so
    // the declaration moved to the SHARED rule. See the "no launcher restates
    // it" case below, which is what stops it drifting back.
    expect(rule('.ze-toolbar').background).toBe('var(--content-bg)');
    expect(rule('.ze-wks .ze-msgpanel').background).toBe('var(--content-bg)');
    // There IS no separate strip any more, and that is the point: upstream
    // adds the origin and page choices to the toolbar itself
    // (`toolbars_pl_editor.cpp:132,157`), so a wrapper painting a second
    // colour behind them could only ever diverge. It carried `--chrome-bg`
    // deliberately for a while — on `--content-bg` the two combos are exactly
    // their own backdrop and read as having no box — but that is true upstream
    // too, where a wxChoice is told apart from the strip by its border alone.
    // Strict parity now; the border does the work.
    expect(SHELL).not.toContain('.ze-wks-topbar {');
    // A literal here would be a second name for a token that already exists.
    expect(rule('.ze-toolbar').background).not.toMatch(/#/);
    expect(rule('.ze-wks .ze-msgpanel').background).not.toMatch(/#/);
  });

  it('leaves the menu bar and the status bar on the darker chrome', () => {
    // Only these two are #2c2c2c upstream, and both already were.
    expect(TOKENS['--chrome-bg']).toBe('#2c2c2c');
    expect(rule('.ze-toolbar').background).not.toBe('var(--chrome-bg)');
  });

  it('measures 39px toolbars and a 37px message panel', () => {
    expect(rule('.ze-wks .ze-toolbar.horizontal').height).toBe('39px');
    expect(rule('.ze-wks .ze-toolbar.vertical').width).toBe('39px');
    expect(rule('.ze-wks .ze-msgpanel')['min-height']).toBe('37px');
  });

  it('states the toolbar strip once, and lets no launcher restate it', () => {
    // The specificity trap, per OCCURRENCE rather than per file: a rule like
    // `.ze-wks .ze-toolbar` at (0,2,0) beats the shared `.ze-toolbar` at
    // (0,1,0), so the launcher-local copy silently wins and fixing the shared
    // thing changes nothing at the call site. Exactly one rule in the whole
    // stylesheet may give a `.ze-toolbar` a background, and it is the bare one.
    const painters: string[] = [];
    for (const m of CSS_CODE.matchAll(/(^|\n)([^\n{}]*\.ze-toolbar[^\n{}]*)\{([^}]*)\}/g)) {
      if (/(^|[;\s])background\s*:/.test(m[3]!)) painters.push(m[2]!.trim());
    }
    expect(painters).toStrictEqual(['.ze-toolbar']);
  });

  it('lets the strip be as tall as its tallest tool, rather than pinning it', () => {
    // [px] GerbView: the TOP_AUX row is 36 px around a 34 px combo (bordered
    // y 135..168, row 135..170) and the left strip is 34 px around a 30 px
    // button (x 66..99, button 68..97). Both are `--ctl-height` /
    // `--toolbar-button-size` plus the toolbar's own padding, so the shared
    // rule states no size at all. Ours pinned 32 px, one pixel under the button
    // it holds and three under the combo, and squeezed every toolbar combo to
    // 31 px.
    expect(rule('.ze-toolbar.horizontal').height).toBeUndefined();
    expect(rule('.ze-toolbar.vertical').width).toBeUndefined();
    // The message panel HAS now been promoted, and the 32 px this line used to
    // guard was wrong. The guard was right to exist: it said one frame's
    // measurement must not move six. What promotes it is evidence that is not
    // one frame's.
    //
    //   EDA_DRAW_FRAME, shared by all six:
    //     m_msgFrameHeight = m_messagePanel->GetBestSize().y;   :146
    //     m_messagePanel->SetSize( m_frameSize.x, m_msgFrameHeight );  :153
    //   EDA_MSG_PANEL, the only thing that answers it:
    //     wxSize( wxDefaultCoord, 2 * m_fontSize.y + 0 )   msgpanel.cpp:78
    //     m_fontSize = GetTextExtent( "W" ) in KIUI::GetControlFont  :71-72
    //
    // Nothing overrides that height per frame - the only SetMinSize calls on a
    // message panel anywhere are in three dialogs, none of them a draw frame.
    // So the height is a property of EDA_MSG_PANEL, not of pl_editor.
    //
    // Its value here: qa/probes/aui_sash_probe.cpp asks wx for the text extent
    // under this theme and gets 14 x 18, so 36; and sampling a real GerbView
    // capture down x=400 finds a 1px rule at y=1140, rgb(55,55,55) for rows
    // 1141..1176 - 36 of them - then the status bar. A probe and a running
    // KiCad, sharing no step.
    expect(rule('.ze-msgpanel')['min-height']).toBe('36px');
  });

  it('keeps this frame scoped for the sizes it alone measured', () => {
    // And the frame has to actually carry the class the rules key on.
    expect(EDITOR).toContain('className="ze-app ze-wks"');
    expect(EDITOR).not.toContain('className="ze-wks-topbar"');
  });
});

describe('C9: the frame opens in mils, and the grid does not follow the unit', () => {
  it('defaults the unit toggle group to mils', () => {
    // app_settings.cpp:227-232 - pl_editor, eeschema and symbol_editor default
    // system.units to EDA_UNITS::MILS; every other app defaults to MM.
    //
    // The launch set used to be a literal in the editor and is now the settings
    // file replayed onto the toolbar, so this asks the replay rather than
    // reading a line of source.
    const boot = togglesFromSettings(structuredClone(PL_EDITOR_DEFAULTS));
    expect(boot.has('unitsMils')).toBe(true);
    expect(boot.has('unitsMm')).toBe(false);
    expect(boot.has('unitsInches')).toBe(false);
    // And the frame has to actually seed itself that way.
    expect(EDITOR).toContain('togglesFromSettings(settings.plEditor)');
  });

  it('opens in EDIT mode, so the title block shows its ${...} tokens', () => {
    /*
     * The bug that read as "no default sheet loads". PL_EDITOR_FRAME's
     * constructor sets
     *
     *     DS_DATA_MODEL::GetTheInstance().m_EditMode = true;  // pl_editor_frame.cpp:105
     *
     * making `layoutEditMode` the checked button of the pair on launch, and
     * `ds_data_item.cpp:543-545` then does `m_FullText = m_TextBase` — no
     * substitution — so real pl_editor opens on `Title: ${TITLE}`,
     * `${COMPANY}`, `Id: ${#}/${##}`.
     *
     * Booting `layoutNormalMode` instead showed substituted PREVIEW text
     * (`Title:`, `Size: A4`, `Id: 1/1`), i.e. a drawing-sheet EDITOR rendering
     * the sheet rather than offering the tokens to edit.
     *
     * It is not a setting, either: no parameter binds `m_EditMode` and the
     * constructor forces it true on every construction, so the replay puts it
     * on regardless of what is stored.
     */
    const boot = togglesFromSettings(structuredClone(PL_EDITOR_DEFAULTS));
    expect(boot.has('layoutEditMode')).toBe(true);
    expect(boot.has('layoutNormalMode')).toBe(false);
  });

  it('feeds that mode straight to the renderer as rawText', () => {
    // `rawText: editMode` is the TS side of the m_EditMode branch above; if the
    // toggle stopped driving it, the boot mode would be right and the canvas
    // still wrong.
    expect(EDITOR).toContain("const editMode = toggles.has('layoutEditMode');");
    expect(EDITOR).toContain('rawText: editMode,');
  });

  it('pins the grid to pl_editor default 0.5 mm, unit-independently', () => {
    // grid.last_size defaults to 4 for pl_editor (app_settings.cpp:466-472)
    // into DefaultGridSizeList()'s pl_editor list (:605-614), entry 4 = 0.50 mm.
    // That is the "grid 19.685039" the audit measured in mils.
    //
    // The spacing was a literal mmToIU(0.5) until DSP-14 gave the canvas
    // context menu its Grid submenu, which needs the grid to be settable. It is
    // now an index into the same shared table, starting at the same entry —
    // what this pins is that it is the TABLE's default and not the unit's.
    //
    // It is now a persisted setting as well, so the default moved into
    // `PL_EDITOR_DEFAULTS` — where it is still the shared table's entry and not
    // a second copy of the number.
    //
    // And the LIST moved there too, once Preferences > Drawing Sheet Editor >
    // Grids could edit it: `PANEL_GRID_SETTINGS` writes `m_grids` back into
    // `gridCfg.grids` (`common/dialogs/panel_grid_settings.cpp:190-192`), so a
    // canvas still reading `DefaultGridSizeList()` directly would make every
    // row on that page a control nothing obeys. What this pins is unchanged —
    // the spacing is the TABLE's default entry and not the unit's — but the
    // table now reaches the canvas through the settings object, so both links
    // are checked: the stored default IS the shared table, and the canvas
    // indexes the stored list.
    expect(PL_EDITOR_DEFAULTS.window.grid.last_size_idx).toBe(DEFAULT_GRID_INDEX.pl_editor);
    // `GRID{ name, x, y }` per row since `DIALOG_GRID_SETTINGS` was ported —
    // the stored shape upstream has always had (`grid_settings.h:33-54`). The
    // built-ins are square and nameless, which is what `gridEntryOf` says.
    expect(PL_EDITOR_DEFAULTS.window.grid.sizes).toEqual(
      GRID_SIZE_LIST.pl_editor.map((g) => ({ name: '', x: g.x, y: g.y })),
    );
    expect(EDITOR).toContain('useState(settings.plEditor.window.grid.last_size_idx)');
    expect(EDITOR).toContain('const gridSizes = plCfg.window.grid.sizes;');
    expect(EDITOR).toContain('gridSizes[gridIndex]');
    expect(EDITOR).not.toMatch(/gridIU\s*=\s*unit ===/);
  });
});

const TOOLBARS = read('../../../designer/src/editors/drawingsheet/drawingSheetToolbars.ts');
const CANVAS_TSX = CANVAS; // alias for readability below

/** One menu's item block, sliced out of the `menus` memo. */
function menu(name: string): string {
  // A menu may carry a comment between its label and its items (Preferences
  // does), so anchor on the label and run to that menu's closing `],`.
  const at = EDITOR.indexOf(`        label: '${name}',\n`);
  expect(at, `no ${name} menu`).toBeGreaterThanOrEqual(0);
  const items = EDITOR.indexOf('        items: [', at);
  expect(items, `${name} has no items`).toBeGreaterThan(at);
  const end = EDITOR.indexOf('\n        ],', items);
  return EDITOR.slice(items, end);
}

describe('C2: Place ends with a separator and Reset Grid Origin', () => {
  // menubar.cpp:129-130 - placeMenu->AppendSeparator(); Add( gridResetOrigin ).
  it('has the row, after the Append entry', () => {
    const place = menu('Place');
    const append = place.indexOf('Append Existing Drawing Sheet...');
    const reset = place.indexOf("label: 'Reset Grid Origin'");
    expect(append).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(append);
    expect(place.slice(append, reset)).toContain('{ sep: true }');
  });

  it('is the last row of the menu', () => {
    const place = menu('Place');
    expect(place.lastIndexOf("label: 'Reset Grid Origin'")).toBeGreaterThan(
      place.lastIndexOf('Append Existing Drawing Sheet...'),
    );
  });
});

describe('C3: the accelerators pl_editor declares', () => {
  // Each from its TOOL_ACTION's DefaultHotkey in common/tool/actions.cpp.
  const cases: [string, string, string][] = [
    ['File', 'Save As...', 'Shift+Ctrl+S'],
    ['File', 'Print...', 'Ctrl+P'],
    ['View', 'Zoom to Selection Area', 'Ctrl+F5'],
    ['View', 'Refresh', 'F5'],
    ['Preferences', 'Preferences...', 'Ctrl+,'],
  ];
  for (const [where, label, key] of cases) {
    it(`${label} declares ${key}`, () => {
      const block = menu(where);
      const at = block.indexOf(`label: '${label}'`);
      expect(at, `${label} missing from ${where}`).toBeGreaterThanOrEqual(0);
      // The declaration has to be on this item, not merely somewhere nearby.
      expect(block.slice(at, at + 260)).toContain(`shortcut: '${key}'`);
    });
  }

  it('keeps Undo and Redo declaring theirs', () => {
    // The audit measured the real Edit menu rendering both with no accelerator
    // text, but ACTION_MENU::updateHotKeys (action_menu.cpp:355-388) DOES set
    // one for every action carrying a hotkey, and in this app the menu string
    // is the hotkey declaration - dropping it would drop Ctrl+Z itself.
    const edit = menu('Edit');
    expect(edit).toContain("shortcut: 'Ctrl+Z'");
    expect(edit).toContain("shortcut: 'Ctrl+Y'");
  });
});

describe('C4: FriendlyName text', () => {
  it('New carries an ellipsis (ACTIONS::doNew, "New...")', () => {
    expect(menu('File')).toContain("label: 'New...'");
  });

  it('is "Zoom to Selection Area", not "Zoom to Selection"', () => {
    const view = menu('View');
    expect(view).toContain("label: 'Zoom to Selection Area'");
    expect(view).not.toContain("label: 'Zoom to Selection',");
  });

  it('is "Refresh", not "Redraw View" (ACTIONS::zoomRedraw)', () => {
    const view = menu('View');
    expect(view).toContain("label: 'Refresh'");
    expect(view).not.toContain("label: 'Redraw View'");
  });

  it('spells the delete accelerator "Delete" (WXK_DELETE), not "Del"', () => {
    const edit = menu('Edit');
    expect(edit).toContain("shortcut: 'Delete'");
    expect(edit).not.toContain("shortcut: 'Del'");
  });
});

describe('C5: zoomTool is an armed rubber-band tool', () => {
  it('the menu row arms the tool and is never disabled', () => {
    const view = menu('View');
    const at = view.indexOf("label: 'Zoom to Selection Area'");
    const row = view.slice(at, at + 260);
    expect(row).toContain("setActiveTool('zoomTool')");
    // Upstream needs no selection, so the row has no `disabled` condition.
    expect(row).not.toContain('disabled:');
  });

  it('the toolbar button arms it too, and is a TOGGLE', () => {
    expect(EDITOR).toContain("case 'zoomTool':");
    const at = EDITOR.indexOf("case 'zoomTool':");
    expect(EDITOR.slice(at, at + 400)).toContain("setActiveTool('zoomTool')");
    expect(EDITOR.slice(at, at + 400)).not.toContain('zoomToSelection');
    const tb = TOOLBARS.indexOf("id: 'zoomTool'");
    expect(TOOLBARS.slice(tb, tb + 220)).toContain('toggle: true');
  });

  it('drags a region and scales by the larger axis ratio', () => {
    // zoom_tool.cpp:145-155.
    expect(CANVAS_TSX).toContain("mode: 'zoom'");
    expect(CANVAS_TSX).toContain('Math.max(Math.abs(w / sw), Math.abs(h / sh))');
    expect(CANVAS_TSX).toContain('out ? v.scale * ratio : v.scale / ratio');
  });

  it('right-drag zooms out and a zero-size box does nothing', () => {
    expect(CANVAS_TSX).toContain('out: e.button === 2');
    expect(CANVAS_TSX).toContain('if (w === 0 || h === 0) return;');
  });

  it('STAYS armed after a zoom — only a cancel ends it', () => {
    // The condition read backwards. `selectRegion()` returns `cancelled`:
    //
    //     bool cancelled = false;
    //     if( evt->IsCancelInteractive() || evt->IsActivate() ) cancelled = true;
    //     ... view->SetScale( scale ); view->SetCenter( ... ); break;
    //     return cancelled;                        (zoom_tool.cpp:78-160)
    //
    // so `if( selectRegion() ) break;` in `Main` (:41-42) breaks on a CANCEL,
    // not on a zoom. A completed region falls through to `while( Wait() )`
    // again with the ZOOM_IN cursor still set, which is why upstream lets you
    // zoom in twice without re-picking the tool. Ours called `onToolDone()` on
    // the successful path — and said in its own comment that upstream did too.
    //
    // Per-occurrence and read against the whole file: `onToolDone` was the ONLY
    // way this canvas could clear the active tool, so its absence is the rule.
    // Escape still ends it, through the editor's own cancel chain (C7).
    expect(CANVAS_TSX).not.toContain('onToolDone');
    expect(EDITOR).not.toContain('onToolDone');
    // And the gesture still completes: the tool staying armed must not have
    // been achieved by never finishing the zoom.
    const up = CANVAS_TSX.slice(CANVAS_TSX.indexOf('const onPointerUp'));
    const zoomArm = up.slice(up.indexOf("g.mode === 'zoom'"), up.indexOf("g.mode === 'box'"));
    expect(zoomArm).toContain('zoomToRegion(b, g.out)');
    expect(zoomArm).not.toContain('setActiveTool');
  });

  it('is ended by Escape, which is the cancel half of the same condition', () => {
    // `evt->IsCancelInteractive()` — the other branch, the one that DOES set
    // `cancelled` and break out of `Main`. PL_ACTIONS' cancel chain backs out
    // of the tool before it drops the selection.
    //
    // Asserted as an ORDER, not as a fixed slice of the handler: the chain has
    // grown links since (a point drag rolls back, a live gesture is dropped),
    // and what has to hold is that disarming the tool still comes before
    // emptying the selection — not that the two sit within N characters of the
    // top.
    const esc = EDITOR.slice(EDITOR.indexOf("if (e.key === 'Escape')"));
    const body = esc.slice(0, esc.indexOf('\n      }'));
    const disarm = body.indexOf("setActiveTool('select')");
    const drop = body.indexOf('setSelection(new Set())');
    expect(body).toContain("else if (activeTool !== 'select') setActiveTool('select');");
    expect(disarm).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(-1);
    expect(disarm).toBeLessThan(drop);
  });
});

describe('C6: the frame title', () => {
  // pl_editor_frame.cpp:570-586. Behavioural, not textual: the extension rule
  // is wxFileName::GetName(), which has edge cases a `toContain` cannot see.
  const P = '[no drawing sheet loaded]';

  it('drops the extension, as wxFileName::GetName() does', () => {
    expect(frameTitleName('pagelayout_default.kicad_wks', P)).toBe('pagelayout_default');
    expect(frameTitleName('A4_ISO5457-1999_ISO7200-2004_EN.kicad_wks', P)).toBe(
      'A4_ISO5457-1999_ISO7200-2004_EN',
    );
    // Only the LAST extension goes.
    expect(frameTitleName('sheet.v2.kicad_wks', P)).toBe('sheet.v2');
    // A name with no extension is left alone.
    expect(frameTitleName('sheet', P)).toBe('sheet');
    // A leading dot is not an extension.
    expect(frameTitleName('.hidden', P)).toBe('.hidden');
  });

  it('falls back to the frame placeholder when nothing is loaded', () => {
    // File > New does SetCurrentFileName( wxEmptyString ), so this is live.
    expect(frameTitleName('', P)).toBe(P);
    expect(frameTitleName(null, P)).toBe(P);
    expect(frameTitleName('   ', P)).toBe(P);
  });

  it('separates the halves with an em dash, not an ASCII hyphen', () => {
    expect(FRAME_TITLE_SEPARATOR).toBe(' \u2014 ');
    expect(FRAME_TITLE_SEPARATOR).not.toContain('-');
  });

  it('is what the frame actually renders', () => {
    expect(EDITOR).toContain("frameTitleName(fileName, '[no drawing sheet loaded]')");
    expect(EDITOR).toContain('{FRAME_TITLE_SEPARATOR}');
    expect(EDITOR).not.toContain('&nbsp;-&nbsp;Drawing Sheet Editor');
  });
});

describe('C7: the left toolbar is toggleGrid plus one Units group', () => {
  it('renders the three units as a single ACTION_GROUP', () => {
    const at = TOOLBARS.indexOf('DS_LEFT_TOOLBAR');
    const block = TOOLBARS.slice(at, TOOLBARS.indexOf('DS_RIGHT_TOOLBAR', at));
    expect(block).toContain("group: 'Units'");
    expect(block).toContain('cycleOnClick: true');
    for (const id of ['unitsMm', 'unitsInches', 'unitsMils']) expect(block).toContain(id);
  });

  it('has no separator between the grid button and the group', () => {
    // toolbars_pl_editor.cpp:48-59 chains AppendAction().AppendGroup() with no
    // AppendSeparator between them.
    const at = TOOLBARS.indexOf('DS_LEFT_TOOLBAR');
    const block = TOOLBARS.slice(at, TOOLBARS.indexOf('DS_RIGHT_TOOLBAR', at));
    expect(block).not.toContain('\n  sep,');
  });
});

describe('D4: the toolbar combos are sized like wxChoice, not stretched', () => {
  // These two are the shared `Combo` (ui/Combo.tsx) now, not native <select>s,
  // so the strip sets LAYOUT only and the widget brings its own height and face.
  it('does not stretch across the toolbar strip', () => {
    expect(rule('.ze-toolbar .ze-combo').flex).toBe('0 0 auto');
  });

  it('sizes to its widest option, as UpdateToolbarControlSizes does', () => {
    expect(rule('.ze-toolbar .ze-combo').width).toBe('max-content');
  });

  it('stands at the one shared GTK control height, from the widget', () => {
    // Not restated on the strip: a local rule of that shape is (0,2,0) and
    // outranks `.ze-combo`'s (0,1,0), which is how a launcher-local sheet went
    // on overriding the shared widget after the widget itself had been fixed.
    expect(rule('.ze-combo').height).toBe('var(--ctl-height)');
    expect(rule('.ze-toolbar .ze-combo').height).toBeUndefined();
    expect(TOKENS['--ctl-height']).toBe('34px');
  });

  it('drops the inline layout the JSX was carrying', () => {
    expect(EDITOR).not.toContain('className="ze-wks-topbar"');
    expect(EDITOR).not.toContain("<div style={{ display: 'flex', alignItems: 'center', flexWrap");
  });
});

/* ---------------------------------------------------------------------------
 * The colours pl_editor does NOT read out of a COLOR_SETTINGS layer.
 *
 * central_values.test.ts counts an unmarked literal; it cannot check that a
 * MARKED one is the right value, because a citation is prose. That is what this
 * block is for: each expectation is recomputed here from the COLOR4D arithmetic
 * in the C++, so changing the constant without changing the derivation fails.
 * ------------------------------------------------------------------------- */

/** `COLOR4D::Brightened`, include/gal/color4d.h:269-275: c*(1-f) + f. */
const brightened = (c: number, f: number): number =>
  Math.round((c / 255) * (1 - f) * 255 + f * 255);
/** `COLOR4D::Darkened`, the same file: c*(1-f). */
const darkened = (c: number, f: number): number => Math.round((c / 255) * (1 - f) * 255);
/** COLOR4D channels are 0..1 floats; wxColour and CSS want 0..255. */
const ch = (f: number): number => Math.round(f * 255);

describe('the selection colours, derived rather than transcribed', () => {
  it('a selected item is RED brightened by half, because LoadColors skips it', () => {
    // ds_painter.cpp:46-53 sets m_selectedColor = m_normalColor.Brightened(0.5)
    // with m_normalColor = RED; LoadColors() (:58-70), the one function
    // pl_draw_panel_gal.cpp:59 calls, overwrites the background, the page
    // border and the normal colour and NOT the selection. RED is {132,0,0},
    // common/gal/color4d.cpp:61.
    const [r, g, b] = [brightened(132, 0.5), brightened(0, 0.5), brightened(0, 0.5)];
    expect(DS_SELECTED_COLOR).toBe(`rgb(${r}, ${g}, ${b})`);
    // ...and it is emphatically not the blue it used to be, which is in no
    // KiCad source file at all.
    expect(DS_SELECTED_COLOR).not.toBe('#4aa3ff');
  });

  it('a brightened item is FULL green at 0.9 alpha', () => {
    // ds_painter.cpp:50 - COLOR4D( 0.0, 1.0, 0.0, 0.9 ). It was 0,230,0.
    expect(DS_BRIGHTENED_COLOR).toBe(`rgba(${ch(0)}, ${ch(1)}, ${ch(0)}, 0.9)`);
  });

  it('the marquee has one fill per background and differs only in the outline', () => {
    // selection_area.cpp:44-62, the two SELECTION_COLORS; :105-106 picks by
    // IsBackgroundDark(); :116-121 fills with `normal` either way and strokes
    // outline_l2r left-to-right, outline_r2l right-to-left.
    expect(DS_MARQUEE.onDark.fill).toBe(`rgba(${ch(0.3)}, ${ch(0.3)}, ${ch(0.7)}, 0.3)`);
    expect(DS_MARQUEE.onDark.outlineL2R).toBe(`rgb(${ch(1.0)}, ${ch(1.0)}, ${ch(0.4)})`);
    expect(DS_MARQUEE.onDark.outlineR2L).toBe(`rgb(${ch(0.4)}, ${ch(0.4)}, ${ch(1.0)})`);
    expect(DS_MARQUEE.onLight.fill).toBe(`rgba(${ch(0.5)}, ${ch(0.3)}, ${ch(1.0)}, 0.5)`);
    expect(DS_MARQUEE.onLight.outlineL2R).toBe(`rgb(${ch(0.7)}, ${ch(0.7)}, ${ch(0.0)})`);
    expect(DS_MARQUEE.onLight.outlineR2L).toBe(`rgb(${ch(0.1)}, ${ch(0.1)}, ${ch(1.0)})`);
    // One fill, not one per direction - the bug this replaced.
    expect(DS_MARQUEE.onDark.outlineL2R).not.toBe(DS_MARQUEE.onDark.outlineR2L);
  });

  it('an edit point is LAYER_AUX_ITEMS, inverted against a pale canvas', () => {
    // edit_points.cpp:257-261: fill = GetLayerColor( LAYER_AUX_ITEMS ), which
    // is white (builtin_color_themes.h:159), inverted when it is within 0.5 of
    // the clear colour. This editor's paper is rgb(245,244,239), so it inverts;
    // the black-background option leaves it white.
    expect(DS_EDIT_POINT_ON_LIGHT.fill).toBe('rgb(0, 0, 0)');
    expect(DS_EDIT_POINT_ON_DARK.fill).toBe('rgb(255, 255, 255)');
    // :265-282, the border is derived from the FILL's own brightness: at 0 the
    // else branch Brightens by 0.7, at 1 the first branch Darkens by 0.7, and
    // both take alpha 0.8.
    const up = brightened(0, 0.7);
    const down = darkened(255, 0.7);
    expect(DS_EDIT_POINT_ON_LIGHT.border).toBe(`rgba(${up}, ${up}, ${up}, 0.8)`);
    expect(DS_EDIT_POINT_ON_DARK.border).toBe(`rgba(${down}, ${down}, ${down}, 0.8)`);
  });

  it('the canvas asks for the pair that matches the background it just cleared to', () => {
    // Both are per-background, so reading the wrong one is a live bug that no
    // colour value can show. `darkBg` is what dsBackgroundIsDark returned.
    expect(CANVAS).toContain('darkBg ? DS_MARQUEE.onDark : DS_MARQUEE.onLight');
    expect(CANVAS).toContain('darkBg ? DS_EDIT_POINT_ON_DARK : DS_EDIT_POINT_ON_LIGHT');
  });
});

describe('D7: this editor adds no new hardcoded font size', () => {
  /*
   * KiCad sets a font on none of these panels - every one inherits
   * wxSYS_DEFAULT_GUI_FONT, which is why its frames all look alike. Ours
   * carries 14 inline sizes across three values. They are NOT changed here:
   * the token they should become, `--ui-font-size`, is under review (the
   * audit measured 13px for the menu bar against the token's 14.667px), and
   * PropertiesFrame.tsx is the unit-binder PR's file. This test is a ratchet
   * so the count cannot grow while that is settled - see the PR.
   */
  const FILES = ['DesignInspector.tsx', 'PropertiesFrame.tsx', 'DrawingSheetEditor.tsx'];

  it('holds at the 6 known sites', () => {
    let n = 0;
    for (const f of FILES) {
      const src = read(`../../../designer/src/editors/drawingsheet/${f}`);
      n += [...src.matchAll(/fontSize:\s*\d/g)].length;
    }
    // 14 until UnitField took MmField's literal "mm" span away, then 13 until
    // the B5 label pass dropped the two invented "deg" spans by Rotation, then
    // 11 until DSP-21 tokenised PropertiesFrame.tsx — which took its four
    // (the type label, the Syntax Help link, the size-info line and the Syntax
    // Help dialog body) into --ui-font-size, leaving 7 in the two dialogs that
    // have not had their turn — and then 6, when the central-values pass gave
    // DesignInspector.tsx the shared `.ze-grid` skin and its own table stopped
    // declaring a size at all.
    // 6 until Preview Settings was rebuilt as DIALOG_PAGES_SETTINGS: the five
    // inline sizes went with the hand-rolled layout it replaced. The one left
    // was the editor's own Preferences modal, whose body declared
    // `fontSize: 12`.
    //
    // 0 now: that modal is gone. The Drawing Sheet Editor opens the shared
    // `PreferencesDialog` — `EDA_BASE_FRAME::ShowPreferences` is on the base
    // frame precisely so no editor writes its own — and the shared dialog sets
    // no font, exactly as KiCad's panels set none. This is the ratchet moving
    // the way it is supposed to: a pass that removes a literal lowers the
    // number rather than leaving slack behind for the next one to spend.
    //
    // Zero is a real floor here, not a vacuous one: the three files are still
    // scanned, so the next inline size added to any of them fails this.
    //
    // PageSettingsDialog.tsx is off this list because the FILE is gone: this
    // editor no longer keeps its own copy of DIALOG_PAGES_SETTINGS, it opens
    // the shared `dialogs/dialog_page_settings.tsx` that pcbnew and eeschema
    // open. Dropping a file from a ratchet is exactly how one goes vacuous, so
    // note what still guards the merged component: `dialogs` has its own row in
    // ui_font_tokens.test.ts's BASELINE (5, lowered from 13 by this merge), and
    // that scanner walks the whole of designer/src.
    expect(n).toBe(0);
  });

  it('adds none in the chrome this PR wrote', () => {
    const at = SHELL.indexOf('.ze-wks .ze-toolbar.horizontal {');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(SHELL.slice(at)).not.toMatch(/font-size:\s*\d/);
  });
});
