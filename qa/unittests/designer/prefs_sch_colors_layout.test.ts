// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Colors — `PANEL_EESCHEMA_COLOR_SETTINGS`
 * over `PANEL_COLOR_SETTINGS` (`common/dialogs/panel_color_settings_base.cpp`).
 *
 * The page was wrong in every dimension a colour page has:
 *
 *   * `createSwatches` walks SCH_LAYER_ID_START..END, drops the four in
 *     `g_excludedLayers`, and sorts what is left by `LayerName`. Ours listed 37
 *     of the 48 rows in an order of its own, so six layers a user can colour in
 *     KiCad had no row at all and "Highlighted items" sat third.
 *   * `m_colorsGridSizer` is a `wxFlexGridSizer( 0, 2, 0, 0 )` — swatch, label,
 *     one row each. Ours was a two-ACROSS grid of pairs, which is a different
 *     shape reached by reading "2" as columns of rows.
 *   * `m_colorsListWindow` is proportion 0 and `m_preview` proportion 1
 *     (`panel_eeschema_color_settings.cpp:227`): the list takes its content
 *     width plus a 20 px margin and the preview takes the rest. We drew no
 *     preview, so the swatches spread across the whole page.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLOR_LAYERS } from '@ziroeda/designer/src/editors/schematic/prefs/PanelEeschemaColorSettings.js';
import { colorThemeOptions } from '@ziroeda/designer/src/dialogs/prefs/ColorThemeChoice.js';
import { COLOR_PREVIEW_SCHEMATIC } from '@ziroeda/designer/src/editors/schematic/prefs/color_preview_schematic.js';

const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

/**
 * `SCH_LAYER_ID` in DECLARATION order (`include/layer_ids.h:355-408`), which is
 * deliberately not the order the panel lists them in: the panel sorts by name,
 * so a layer dropped or misnamed shows up as a difference between these two
 * arrangements rather than as a copy of one.
 */
const SCH_LAYER_IDS = [
  'LAYER_WIRE',
  'LAYER_BUS',
  'LAYER_JUNCTION',
  'LAYER_LOCLABEL',
  'LAYER_GLOBLABEL',
  'LAYER_HIERLABEL',
  'LAYER_PINNUM',
  'LAYER_PINNAM',
  'LAYER_REFERENCEPART',
  'LAYER_VALUEPART',
  'LAYER_FIELDS',
  'LAYER_INTERSHEET_REFS',
  'LAYER_NETCLASS_REFS',
  'LAYER_RULE_AREAS',
  'LAYER_DEVICE',
  'LAYER_NOTES',
  'LAYER_PRIVATE_NOTES',
  'LAYER_NOTES_BACKGROUND',
  'LAYER_PIN',
  'LAYER_SHEET',
  'LAYER_SHEETNAME',
  'LAYER_SHEETFILENAME',
  'LAYER_SHEETFIELDS',
  'LAYER_SHEETLABEL',
  'LAYER_NOCONNECT',
  'LAYER_DANGLING',
  'LAYER_DNP_MARKER',
  'LAYER_ERC_WARN',
  'LAYER_ERC_ERR',
  'LAYER_ERC_EXCLUSION',
  'LAYER_EXCLUDED_FROM_SIM',
  'LAYER_SHAPES_BACKGROUND',
  'LAYER_DEVICE_BACKGROUND',
  'LAYER_SHEET_BACKGROUND',
  'LAYER_SCHEMATIC_GRID',
  'LAYER_SCHEMATIC_GRID_AXES',
  'LAYER_SCHEMATIC_BACKGROUND',
  'LAYER_SCHEMATIC_CURSOR',
  'LAYER_HOVERED',
  'LAYER_BRIGHTENED',
  'LAYER_HIDDEN',
  'LAYER_NET_COLOR_HIGHLIGHT',
  'LAYER_DRAG_NET_COLLISION',
  'LAYER_SELECTION_SHADOWS',
  'LAYER_SCHEMATIC_DRAWINGSHEET',
  'LAYER_SCHEMATIC_PAGE_LIMITS',
  'LAYER_BUS_JUNCTION',
  'LAYER_SCHEMATIC_AUX_ITEMS',
  'LAYER_SCHEMATIC_ANCHOR',
  'LAYER_OP_VOLTAGES',
  'LAYER_OP_CURRENTS',
  'LAYER_GROUP',
];

/** `g_excludedLayers` (`panel_eeschema_color_settings.cpp:52-58`). */
const EXCLUDED = [
  'LAYER_NOTES_BACKGROUND',
  'LAYER_DANGLING',
  'LAYER_NET_COLOR_HIGHLIGHT',
  'LAYER_GROUP',
];

describe('the list is every layer createSwatches keeps, in its order', () => {
  it('holds SCH_LAYER_ID minus g_excludedLayers, and nothing else', () => {
    const listed = [...COLOR_LAYERS.map((r) => r.layer)].sort();
    const expected = SCH_LAYER_IDS.filter((l) => !EXCLUDED.includes(l)).sort();
    expect(listed).toEqual(expected);
    expect(listed).toHaveLength(48);
  });

  it('sorts by LayerName under wxString::operator<, a byte comparison', () => {
    // The sort runs BEFORE `name += " (symbol editor only)"` is appended
    // (`:203-207`), so LAYER_SCHEMATIC_GRID_AXES sorts as the bare "Axes".
    const key = (name: string): string => name.replace(' (symbol editor only)', '');
    for (let i = 1; i < COLOR_LAYERS.length; i++) {
      const a = key(COLOR_LAYERS[i - 1]!.name);
      const b = key(COLOR_LAYERS[i]!.name);
      expect(a < b, `${a} should sort before ${b}`).toBe(true);
    }
  });

  it('puts a space before a letter, which is the whole reason to say so', () => {
    // The two pairs an alphabetiser gets wrong: "Bus junctions" / "Buses" and
    // "Pin names" / "Pins".
    const at = (name: string): number => COLOR_LAYERS.findIndex((r) => r.name === name);
    expect(at('Bus junctions')).toBeLessThan(at('Buses'));
    expect(at('Pin names')).toBeLessThan(at('Pins'));
    expect(at('Pin numbers')).toBeLessThan(at('Pins'));
  });

  it('appends the suffix to the axes row alone', () => {
    const suffixed = COLOR_LAYERS.filter((r) => r.name.includes('(symbol editor only)'));
    expect(suffixed.map((r) => r.layer)).toEqual(['LAYER_SCHEMATIC_GRID_AXES']);
  });

  /** A row is live exactly when our painter has a `Theme` field for its layer. */
  it('leaves the six layers no painter of ours reads without a key', () => {
    const dead = COLOR_LAYERS.filter((r) => r.key === null).map((r) => r.layer);
    expect(dead.sort()).toEqual(
      [
        'LAYER_DRAG_NET_COLLISION',
        'LAYER_HOVERED',
        'LAYER_INTERSHEET_REFS',
        'LAYER_OP_CURRENTS',
        'LAYER_OP_VOLTAGES',
        'LAYER_SHAPES_BACKGROUND',
      ].sort(),
    );
  });

  it('reads each live row through one Theme field, never two', () => {
    const keys = COLOR_LAYERS.map((r) => r.key).filter((k) => k !== null);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the two halves are the proportions m_colorsMainSizer states', () => {
  it('lets the list take its content width and no more', () => {
    // `Add( m_colorsListWindow, 0, wxEXPAND|wxLEFT|wxRIGHT, 5 )` — proportion 0.
    expect(rule('.ze-colorlist')).toMatch(/flex:\s*0 0 auto/);
    expect(rule('.ze-colorlist')).toMatch(/margin:\s*0 5px/);
    // `SetBackgroundColour( wxSYS_COLOUR_WINDOW )`, which is --chrome-bg2.
    expect(rule('.ze-colorlist')).toContain('var(--chrome-bg2)');
  });

  it('gives the preview the rest of the row', () => {
    // `Add( m_preview, 1, wxTOP|wxEXPAND, 1 )`.
    expect(rule('.ze-colorpreview')).toMatch(/flex:\s*1/);
    expect(rule('.ze-colorpreview')).toMatch(/margin-top:\s*1px/);
  });

  it('draws the WX_PANEL top border, and only the top', () => {
    // `m_panel1->SetBorders( false, false, true, false )`.
    const body = rule('.ze-colorpage-body');
    expect(body).toMatch(/border-top:\s*1px solid var\(--content-bg\)/);
    expect(body).not.toMatch(/border-(left|right|bottom)/);
  });

  it('drops the page padding the other pages carry', () => {
    expect(rule('.ze-prefs-panel:has(> .ze-colorpage)')).toMatch(/padding:\s*0/);
  });
});

describe('a row is a swatch and a label, spaced by their own borders', () => {
  it('is two grid columns with no gap of its own', () => {
    const grid = rule('.ze-colorgrid');
    expect(grid).toMatch(/grid-template-columns:\s*max-content max-content/);
    expect(grid).toMatch(/gap:\s*0/);
    // `const int margin = 20` around the sizer.
    expect(grid).toMatch(/padding-right:\s*20px/);
  });

  it('takes the borders the two Add()s state', () => {
    // `wxALL, 3` on the swatch, `wxLEFT, 5` on the label. Together they are the
    // 8 px between them AND the 29 px row pitch (23 + 3 + 3).
    expect(rule('.ze-colorgrid > .ze-swatch')).toMatch(/margin:\s*3px/);
    expect(rule('.ze-colorgrid > span')).toMatch(/padding-left:\s*5px/);
    expect(rule('.ze-colorgrid > span')).toMatch(/white-space:\s*nowrap/);
  });

  it('draws SWATCH_MEDIUM, which measures 48 x 23 on this machine', () => {
    // `ConvertDialogToPixels( SWATCH_SIZE_MEDIUM_DU )` with (24,10) DU —
    // qa/probes/swatch_probe.cpp asks wx itself.
    expect(CSS).toContain('--swatch-medium-w: 48px');
    expect(CSS).toContain('--swatch-medium-h: 23px');
  });
});

/**
 * `createPreviewItems` (`panel_eeschema_color_settings.cpp:245-470`) builds the
 * sample document in code — it is not the open project and not a file on disk.
 * Ours transcribes it as `.kicad_sch` text and reads it through the ordinary
 * reader, so the counts below are what the C++ constructs.
 */
describe('the preview draws the sample document upstream builds', () => {
  it('is a User page of 6000 x 5000 mils titled Color Preview', () => {
    // `PAGE_SIZE_TYPE::User` with `SetWidthMils( 6000 )` / `SetHeightMils( 5000 )`
    // (`:255-256`), which the file format writes in millimetres.
    expect(COLOR_PREVIEW_SCHEMATIC.paper).toBe(
      `User ${(6000 * 0.0254).toFixed(4)} ${(5000 * 0.0254).toFixed(4)}`,
    );
    expect(COLOR_PREVIEW_SCHEMATIC.titleBlock?.title).toBe('Color Preview');
  });

  it('carries one item per colour worth showing', () => {
    // `lines` (`:271-284`): eight wires, two bus segments, four notes lines.
    expect(COLOR_PREVIEW_SCHEMATIC.lines).toHaveLength(14);
    // `:315-327`, `:329-348`, `:354-449`.
    expect(COLOR_PREVIEW_SCHEMATIC.noConnects).toHaveLength(1);
    expect(COLOR_PREVIEW_SCHEMATIC.busEntries).toHaveLength(2);
    expect(COLOR_PREVIEW_SCHEMATIC.junctions).toHaveLength(1);
    expect(COLOR_PREVIEW_SCHEMATIC.symbols).toHaveLength(1);
    expect(COLOR_PREVIEW_SCHEMATIC.sheets).toHaveLength(1);
    // `:329-348`: PLAIN TEXT, two local labels, a global and a hierarchical.
    expect(COLOR_PREVIEW_SCHEMATIC.labels.map((l) => l.kind)).toEqual([
      'text',
      'label',
      'label',
      'global_label',
      'hierarchical_label',
    ]);
  });

  it('shows a wire, a bus and four notes lines, told apart by layer', () => {
    // A schematic line's LAYER is its kind: `LAYER_WIRE`, `LAYER_BUS`, and
    // `LAYER_NOTES` for the graphic polyline the notes box is drawn from.
    const kinds = COLOR_PREVIEW_SCHEMATIC.lines.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'wire')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'bus')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'polyline')).toHaveLength(4);
  });
});

/**
 * `PANEL_COLOR_SETTINGS::GetSettingsDropdownName`
 * (`common/dialogs/panel_color_settings.cpp:391-398`) appends " (read-only)" to
 * any theme whose file cannot be written. Ours offered the bare names, so the
 * one thing the choice tells a user about why the swatches below are dead was
 * missing from it.
 */
describe('the theme choice names the read-only themes as such', () => {
  it('says nothing extra for the page that appends GetName() raw', () => {
    // `PANEL_PL_EDITOR_COLOR_SETTINGS::TransferDataToWindow`
    // (`panel_pl_editor_color_settings.cpp:44-53`) — the Drawing Sheet
    // Editor's Colors page, which is the same list without the suffix.
    expect(new Map(colorThemeOptions([])).get('_builtin_default')).toBe('KiCad Default');
  });

  it('marks both built-ins, because CreateBuiltinColorSettings clears m_writeFile', () => {
    const names = new Map(colorThemeOptions([], true));
    expect(names.get('_builtin_default')).toBe('KiCad Default (read-only)');
    expect(names.get('_builtin_classic')).toBe('KiCad Classic (read-only)');
  });

  it('marks an installed theme, which lands in the third-party directory', () => {
    const names = new Map(colorThemeOptions([{ id: 'solarized', name: 'Solarized' }], true));
    expect(names.get('solarized')).toBe('Solarized (read-only)');
  });

  it('leaves the one writable theme unmarked', () => {
    // The invariant is the absence of the suffix, not the name: `user.json`'s
    // `meta.name` defaults to "KiCad Default" (`color_settings.cpp:45-46`) and
    // `loadAllColorSettings` appends the filename when that collides with a
    // built-in (`settings_manager.cpp:466-473`), so the label is
    // "KiCad Default (user)". What must stay true is that the only WRITABLE
    // theme is not called read-only.
    const label = new Map(colorThemeOptions([], true)).get('user');
    expect(label).not.toContain('(read-only)');
    expect(label).toBe('KiCad Default (user)');
  });
});
