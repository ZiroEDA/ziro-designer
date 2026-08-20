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
  DS_PAGE_BORDER_COLOR,
  DS_PRINT_PAPER_COLOR,
} from '@ziroeda/designer/src/editors/drawingsheet/wksRender.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  FRAME_TITLE_SEPARATOR,
  frameTitleName,
} from '@ziroeda/designer/src/ui/useDocumentTitle.js';

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
    expect(CANVAS).toContain('ctx.strokeStyle = DS_PAGE_BORDER_COLOR;');
    expect(CANVAS).toContain('ctx.strokeRect(0, 0, pageW, pageH);');
    // One device pixel: GetDefaultPenWidth() renders as a hairline at any zoom,
    // and `worldPen` is 1 device px expressed in world units.
    const stroke = CANVAS.indexOf('ctx.strokeStyle = DS_PAGE_BORDER_COLOR;');
    expect(CANVAS.slice(stroke, stroke + 200)).toContain('ctx.lineWidth = worldPen;');
  });
});

describe('D5/D6: the drawing-sheet chrome sits on the frame face', () => {
  it('has the frame-background token at the #373737 that was measured', () => {
    expect(TOKENS['--content-bg']).toBe('#373737');
  });

  it('puts the toolbars and the message panel on it, not on the chrome grey', () => {
    expect(rule('.ze-wks .ze-toolbar').background).toBe('var(--content-bg)');
    expect(rule('.ze-wks .ze-msgpanel').background).toBe('var(--content-bg)');
    // `.ze-wks-topbar` is DELIBERATELY not on this list. It is the strip holding
    // the origin and page combos, and `--content-bg` (#373737) is also
    // `--ctl-face`, so the two combos were painted exactly their own backdrop
    // and read as invisible next to the identical combos in the properties
    // panel, which sit on #272727. Akshay asked for them to match the Image
    // Converter's, which sit on #2c2c2c.
    //
    // This is a KNOWN DIVERGENCE from the pl_editor measurement above: upstream
    // that strip really is #373737, and a real wxChoice is told apart from it by
    // its border alone. Revert this one rule to `var(--content-bg)` to go back
    // to strict parity.
    expect(rule('.ze-wks-topbar').background).toBe('var(--chrome-bg)');
    // A literal here would be a second name for a token that already exists.
    expect(rule('.ze-wks .ze-toolbar').background).not.toMatch(/#/);
    expect(rule('.ze-wks .ze-msgpanel').background).not.toMatch(/#/);
  });

  it('leaves the menu bar and the status bar on the darker chrome', () => {
    // Only these two are #2c2c2c upstream, and both already were.
    expect(TOKENS['--chrome-bg']).toBe('#2c2c2c');
    expect(rule('.ze-wks .ze-toolbar').background).not.toBe('var(--chrome-bg)');
  });

  it('measures 39px toolbars and a 37px message panel', () => {
    expect(rule('.ze-wks .ze-toolbar.horizontal').height).toBe('39px');
    expect(rule('.ze-wks .ze-toolbar.vertical').width).toBe('39px');
    expect(rule('.ze-wks .ze-msgpanel')['min-height']).toBe('37px');
  });

  it('scopes all of it to this frame, leaving the other five editors alone', () => {
    // The shared rules keep their own values until the other draw frames are
    // measured; flipping them here would move five editors on one's evidence.
    expect(rule('.ze-toolbar').background).toBe('var(--chrome-bg)');
    expect(rule('.ze-toolbar.horizontal').height).toBe('32px');
    expect(rule('.ze-msgpanel')['min-height']).toBe('32px');
    // And the frame has to actually carry the class the rules key on.
    expect(EDITOR).toContain('className="ze-app ze-wks"');
    expect(EDITOR).toContain('className="ze-wks-topbar"');
  });
});

describe('C9: the frame opens in mils, and the grid does not follow the unit', () => {
  it('defaults the unit toggle group to mils', () => {
    // app_settings.cpp:227-232 - pl_editor, eeschema and symbol_editor default
    // system.units to EDA_UNITS::MILS; every other app defaults to MM.
    const at = EDITOR.indexOf('const DEFAULT_TOGGLES');
    expect(at).toBeGreaterThanOrEqual(0);
    const line = EDITOR.slice(at, EDITOR.indexOf('\n', at));
    expect(line).toContain("'unitsMils'");
    expect(line).not.toContain("'unitsMm'");
    expect(line).not.toContain("'unitsInches'");
  });

  it('opens in EDIT mode, so the title block shows its ${…} tokens', () => {
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
     */
    const at = EDITOR.indexOf('const DEFAULT_TOGGLES');
    expect(at).toBeGreaterThanOrEqual(0);
    const line = EDITOR.slice(at, EDITOR.indexOf('\n', at));
    expect(line).toContain("'layoutEditMode'");
    expect(line).not.toContain("'layoutNormalMode'");
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
    expect(EDITOR).toContain('useState(DEFAULT_GRID_INDEX.pl_editor)');
    expect(EDITOR).toContain('GRID_SIZE_LIST.pl_editor[gridIndex]');
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
    const append = place.indexOf('Append Existing Drawing Sheet…');
    const reset = place.indexOf("label: 'Reset Grid Origin'");
    expect(append).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(append);
    expect(place.slice(append, reset)).toContain('{ sep: true }');
  });

  it('is the last row of the menu', () => {
    const place = menu('Place');
    expect(place.lastIndexOf("label: 'Reset Grid Origin'")).toBeGreaterThan(
      place.lastIndexOf('Append Existing Drawing Sheet…'),
    );
  });
});

describe('C3: the accelerators pl_editor declares', () => {
  // Each from its TOOL_ACTION's DefaultHotkey in common/tool/actions.cpp.
  const cases: [string, string, string][] = [
    ['File', 'Save As…', 'Shift+Ctrl+S'],
    ['File', 'Print…', 'Ctrl+P'],
    ['View', 'Zoom to Selection Area', 'Ctrl+F5'],
    ['View', 'Refresh', 'F5'],
    ['Preferences', 'Preferences…', 'Ctrl+,'],
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
    expect(menu('File')).toContain("label: 'New…'");
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

  it('hands back to the arrow after one region (PopTool)', () => {
    expect(CANVAS_TSX).toContain('onToolDone?.();');
    expect(EDITOR).toContain("onToolDone={() => setActiveTool('select')}");
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
    expect(rule('.ze-wks-topbar .ze-combo').flex).toBe('0 0 auto');
  });

  it('sizes to its widest option, as UpdateToolbarControlSizes does', () => {
    expect(rule('.ze-wks-topbar .ze-combo').width).toBe('max-content');
  });

  it('stands at the one shared GTK control height, from the widget', () => {
    // Not restated on the strip: a local rule of that shape is (0,2,0) and
    // outranks `.ze-combo`'s (0,1,0), which is how a launcher-local sheet went
    // on overriding the shared widget after the widget itself had been fixed.
    expect(rule('.ze-combo').height).toBe('var(--ctl-height)');
    expect(rule('.ze-wks-topbar .ze-combo').height).toBeUndefined();
    expect(TOKENS['--ctl-height']).toBe('34px');
  });

  it('drops the inline layout the JSX was carrying', () => {
    expect(EDITOR).toContain('className="ze-wks-topbar"');
    expect(EDITOR).not.toContain("<div style={{ display: 'flex', alignItems: 'center', flexWrap");
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
  const FILES = [
    'DesignInspector.tsx',
    'PageSettingsDialog.tsx',
    'PropertiesFrame.tsx',
    'DrawingSheetEditor.tsx',
  ];

  it('holds at the 11 known sites', () => {
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
    // have not had their turn.
    expect(n).toBe(7);
  });

  it('adds none in the chrome this PR wrote', () => {
    const at = SHELL.indexOf('.ze-wks .ze-toolbar {');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(SHELL.slice(at)).not.toMatch(/font-size:\s*\d/);
  });
});
