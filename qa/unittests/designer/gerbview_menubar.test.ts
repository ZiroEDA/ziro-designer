// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's menu bar and its three toolbars.
 *
 * Counterparts: `GERBVIEW_FRAME::doReCreateMenuBar` (`gerbview/menubar.cpp`)
 * and `GERBVIEW_TOOLBAR_SETTINGS::DefaultToolbarConfig`
 * (`gerbview/toolbars_gerber.cpp:39-116`).
 *
 * What this is really guarding is the SHARED half. KiCad's launchers feel like
 * one program because three functions in `common/` write the Help menu, the
 * language list and the Quit/Close row for all fifteen frames. GerbView was the
 * one launcher here that had joined none of them: no Help menu at all, no
 * language list, no Preferences entry, and its display toggles filed under a
 * "Preferences" menu that upstream does not have.
 */
import { describe, expect, it } from 'vitest';
import {
  GBR_TOP_TOOLBAR,
  GBR_LEFT_TOOLBAR,
} from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import * as gerberToolbars from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import {
  gerbviewMenus,
  type GerbviewMenuHandlers,
} from '@ziroeda/designer/src/editors/gerbview/menubar.js';
import { standardHelpMenu } from '@ziroeda/designer/src/ui/help_menu.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';
import type { ToolButton, ToolEntry, ToolGroup } from '@ziroeda/designer/src/ui/toolbar_types.js';

const noop = (): void => {};

function handlers(over: Partial<GerbviewMenuHandlers> = {}): GerbviewMenuHandlers {
  return {
    openAutodetected: noop,
    openGerber: noop,
    openDrillFile: noop,
    openJobFile: noop,
    openZipFile: noop,
    clearAllLayers: noop,
    reloadAllLayers: noop,
    exportToPcbnew: noop,
    print: noop,
    quit: noop,
    zoomInCenter: noop,
    zoomOutCenter: noop,
    zoomFitScreen: noop,
    zoomTool: noop,
    zoomRedraw: noop,
    toggle: noop,
    checked: new Set<string>(),
    showDCodes: noop,
    measureTool: noop,
    clearLayer: noop,
    openPreferences: noop,
    language: 'Default',
    onSelectLanguage: noop,
    showHotkeys: noop,
    showAbout: noop,
    ...over,
  };
}

const menus = (over?: Partial<GerbviewMenuHandlers>): Menu[] => gerbviewMenus(handlers(over));
const menu = (label: string, over?: Partial<GerbviewMenuHandlers>): Menu => {
  const m = menus(over).find((x) => x.label === label);
  if (!m) throw new Error(`no ${label} menu`);
  return m;
};
const labels = (m: Menu): string[] => m.items.map((i) => (i.sep ? '---' : (i.label ?? '?')));

describe('the menu bar', () => {
  /** `menuBar->Append` order, `menubar.cpp:222-227`, Help last via AddStandardHelpMenu. */
  it('is File, View, Tools, Preferences, Help', () => {
    expect(menus().map((m) => m.label)).toEqual(['File', 'View', 'Tools', 'Preferences', 'Help']);
  });

  /**
   * The bar used to read File / View / Preferences / Tools with no Help at all.
   * Two separate faults: Tools and Preferences were swapped, and the one menu
   * fifteen KiCad frames share was absent.
   */
  it('has a Help menu, and it is the shared one', () => {
    // Compared by row, not by deep equality: every row carries a closure, and
    // two closures are never `toEqual`. What matters is that the menu is the
    // one `ui/help_menu.ts` builds and not a GerbView-shaped copy of it.
    const shared = standardHelpMenu({ showHotkeys: noop, showAbout: noop });
    expect(menu('Help').label).toBe(shared.label);
    expect(labels(menu('Help'))).toEqual(labels(shared));
  });
});

describe('the Preferences menu', () => {
  /**
   * `menubar.cpp:210-214`:
   *
   *     preferencesMenu->Add( ACTIONS::openPreferences );
   *     preferencesMenu->AppendSeparator();
   *     AddMenuLanguageList( preferencesMenu, selTool );
   *
   * Three rows, and GerbView is one of the frames that DOES put the separator
   * between them - pl_editor does not.
   */
  it('is openPreferences, a separator, and the language list', () => {
    const items = menu('Preferences').items;
    expect(items).toHaveLength(3);
    expect(items[0]?.label).toBe('Preferences...');
    expect(items[0]?.shortcut).toBe('Ctrl+,');
    expect(items[1]?.sep).toBe(true);
    expect(items[2]?.label).toBe('Set Language');
  });

  it('holds no display toggle, because upstream has none here', () => {
    // Ours filed all nine of these under Preferences.
    const text = labels(menu('Preferences')).join('|');
    for (const gone of ['Sketch Lines', 'Show DCodes', 'Flip Gerber View', 'Show Grid'])
      expect(text).not.toContain(gone);
  });
});

describe('the View menu', () => {
  /** `menubar.cpp:160-200`, in order, separators included. */
  it('is the five zooms, grid and polar, Units, the nine display rows, then the manager', () => {
    expect(labels(menu('View'))).toEqual([
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit',
      'Zoom to Selection Area',
      'Refresh',
      '---',
      'Show Grid',
      'Polar Coordinates',
      'Units',
      '---',
      'Sketch Flashed Items',
      'Sketch Lines',
      'Sketch Polygons',
      'Show DCodes',
      'Ghost Negative Objects',
      'Show with Forced Opacity Mode',
      'Show in XOR Mode',
      'Inactive Layer View Mode',
      'Flip Gerber View',
      '---',
      'Show Layers Manager',
    ]);
  });

  /** `unitsSubMenu` (`:178-186`), mm last in the menu though first in the toolbar group. */
  it('nests the three units, in the menu order upstream uses', () => {
    const units = menu('View').items.find((i) => i.label === 'Units');
    expect(units?.submenu?.map((i) => i.label)).toEqual(['Inches', 'Mils', 'Millimeters']);
  });

  it('ticks the row whose toggle is on, and only that one', () => {
    const view = menu('View', { checked: new Set(['flipView']) });
    const on = view.items.filter((i) => i.checked).map((i) => i.label);
    expect(on).toEqual(['Flip Gerber View']);
  });

  /**
   * ACTIONS::highContrastMode's FriendlyName is "Inactive Layer View Mode"
   * (`common/tool/actions.cpp:1207`), not "High Contrast Mode", which is what
   * ours called it. The action is shared, so the string is not GerbView's to
   * choose.
   */
  it('calls high contrast what the shared action calls it', () => {
    expect(labels(menu('View'))).toContain('Inactive Layer View Mode');
    expect(labels(menu('View'))).not.toContain('High Contrast Mode');
  });
});

describe('the Tools menu', () => {
  /** `menubar.cpp:203-208`. Clear Highlight is NOT in it; ours had put it there. */
  it('is List DCodes, Show Source, Measure, then Clear Current Layer', () => {
    expect(labels(menu('Tools'))).toEqual([
      'List DCodes...',
      'Show Source...',
      'Measure Tool',
      '---',
      'Clear Current Layer...',
    ]);
  });
});

describe('the File menu', () => {
  /** `menubar.cpp:47-158`: four openers, each trailed by its own recent list. */
  it('opens with the four file types, each followed by its Open Recent list', () => {
    expect(labels(menu('File')).slice(0, 8)).toEqual([
      'Open Autodetected File(s)...',
      'Open Gerber Plot File(s)...',
      'Open Recent Gerber File',
      'Open Excellon Drill File(s)...',
      'Open Recent Drill File',
      'Open Gerber Job File...',
      'Open Recent Job File',
      'Open Zip Archive File...',
    ]);
  });

  /** `FileHistoryCond` greys a submenu whose history is empty (`:78-80`). */
  it('greys every Open Recent list while no history exists', () => {
    const recents = menu('File').items.filter((i) => i.label?.startsWith('Open Recent'));
    expect(recents).toHaveLength(4);
    for (const r of recents) expect(r.disabled).toBe(true);
  });

  /**
   * The tail, `menubar.cpp:146-158`. It ends on AddQuitOrClose, whose Close
   * branch is the one a frame under the project manager takes
   * (`action_menu.cpp:238-246`) - which every frame here is.
   */
  it('carries clear, reload, export and print, and ends on Close', () => {
    const l = labels(menu('File'));
    expect(l.slice(9)).toEqual([
      '---',
      'Clear All Layers',
      'Reload All Layers',
      '---',
      'Export to PCB Editor...',
      '---',
      'Print...',
      '---',
      'Close',
    ]);
  });

  /**
   * GERBVIEW_ACTIONS::exportToPcbnew's FriendlyName is "Export to PCB Editor..."
   * (`gerbview_actions.cpp:95`). Ours said "Export to Pcbnew…", a spelling that
   * appears nowhere upstream.
   */
  it('names the export by the action, not by the old app name', () => {
    expect(labels(menu('File'))).toContain('Export to PCB Editor...');
    expect(labels(menu('File')).join('|')).not.toContain('Pcbnew');
  });
});

// ---------------------------------------------------------------------------
// toolbars
// ---------------------------------------------------------------------------

const ids = (entries: readonly ToolEntry[]): string[] =>
  entries.flatMap((e) =>
    e === 'sep'
      ? ['---']
      : 'group' in e
        ? [`group:${e.group}`]
        : 'control' in e || 'spacer' in e
          ? []
          : [e.id],
  );

const flat = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) =>
    e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e || 'spacer' in e ? [] : [e],
  );

describe('TOP_MAIN', () => {
  /** `toolbars_gerber.cpp:83-104`. The clear/reload pair comes FIRST. */
  it('is clear, reload, the three openers, print, the five zooms', () => {
    expect(ids(GBR_TOP_TOOLBAR)).toEqual([
      'gerbClear',
      'gerbReload',
      'gerbOpenAutodetected',
      'gerbOpen',
      'gerbOpenDrill',
      '---',
      'print',
      '---',
      'zoomRedraw',
      'zoomIn',
      'zoomOut',
      'zoomFit',
      'zoomTool',
      '---',
    ]);
  });

  /**
   * openJobFile and openZipFile are File-menu entries only
   * (`menubar.cpp:117,135`), and so is exportToPcbnew (`:151`). All three were
   * on our top row; the row that replaces them is openAutodetected, which the
   * toolbar has and the menu also lists first.
   */
  it('carries no job, zip or export button', () => {
    const set = new Set(ids(GBR_TOP_TOOLBAR));
    expect(set.has('gerbOpenJob')).toBe(false);
    expect(set.has('gerbOpenZip')).toBe(false);
    expect(set.has('gerbExportToPcb')).toBe(false);
  });
});

describe('LEFT', () => {
  /** `toolbars_gerber.cpp:50-81`. selectionTool and measureTool head the bar. */
  it('heads with select and measure, which had been on a right-hand bar', () => {
    expect(ids(GBR_LEFT_TOOLBAR).slice(0, 3)).toEqual(['select', 'measure', '---']);
  });

  /** `AppendGroup( TOOLBAR_GROUP_CONFIG( ... ) )` at `:57-64`. */
  it('makes Units and Crosshair modes groups, not six loose buttons', () => {
    expect(ids(GBR_LEFT_TOOLBAR)).toContain('group:Units');
    expect(ids(GBR_LEFT_TOOLBAR)).toContain('group:Crosshair modes');

    const groups = GBR_LEFT_TOOLBAR.filter(
      (e): e is ToolGroup => e !== 'sep' && typeof e === 'object' && 'group' in e,
    );
    // mm first, then inches, then mils - upstream's own order at `:58-60`.
    expect(groups[0]?.actions.map((a) => a.id)).toEqual(['unitsMm', 'unitsInches', 'unitsMils']);
    // small, full, 45 - `:62-64`. We had only the full one.
    expect(groups[1]?.actions.map((a) => a.id)).toEqual([
      'crosshairSmall',
      'crosshairFull',
      'crosshair45',
    ]);
  });

  it('ends on the four compare modes and the layers manager', () => {
    expect(ids(GBR_LEFT_TOOLBAR).slice(-6)).toEqual([
      'forceOpacityMode',
      'xorMode',
      'highContrast',
      'flipView',
      '---',
      'showLayerManager',
    ]);
  });
});

describe('RIGHT', () => {
  /**
   * `case TOOLBAR_LOC::RIGHT: return std::nullopt;` (`toolbars_gerber.cpp:46-48`).
   * We had invented one holding select and measure.
   */
  it('does not exist', () => {
    expect('GBR_RIGHT_TOOLBAR' in gerberToolbars).toBe(false);
  });
});

describe('what is greyed, and what is not', () => {
  /**
   * ZOOM_TOOL is not a GerbView feature to implement or skip: it is 174 lines
   * in `common/tool/zoom_tool.cpp` that ten frames register, GerbView included
   * (`gerbview_frame.cpp:1097`). Greying it was our bug, not upstream's.
   */
  it('leaves Zoom to Selection Area live, on the bar and in the menu', () => {
    const btn = flat(GBR_TOP_TOOLBAR).find((b) => b.id === 'zoomTool');
    expect(btn?.disabled).toBeUndefined();

    const row = menu('View').items.find((i) => i.label === 'Zoom to Selection Area');
    expect(row?.disabled).toBeUndefined();
    expect(row?.action).toBeTypeOf('function');
  });

  /**
   * The ONE that stays greyed, because upstream does something a browser tab
   * cannot: Show Source shells out to `Pgm().GetTextEditor()`
   * (`gerbview_inspection_tool.cpp:154-190`).
   *
   * Forced-opacity mode used to be the second, and is not any more. It was
   * greyed because the renderer composited every layer at a fixed 0.8 alpha,
   * so there was no opaque state for the mode to be the exception to; it now
   * draws opaque and `GerberRenderOptions.layerOpacity` drops to
   * `m_Display.m_OpacityModeAlphaValue` while the mode is on, which is
   * `GERBVIEW_RENDER_SETTINGS::LoadColors` (`gerbview_painter.cpp:63-66`). The
   * value behind it is the `Forced opacity:` spin control on Preferences >
   * Gerber Viewer > Display Options.
   */
  it('greys Show Source, and nothing else', () => {
    const greyMenu = menus()
      .flatMap((m) => m.items)
      .filter((i: MenuItem) => i.disabled && !i.label?.startsWith('Open Recent'))
      .map((i) => i.label);
    expect(greyMenu).toEqual(['Show Source...']);

    const greyBar = [...flat(GBR_TOP_TOOLBAR), ...flat(GBR_LEFT_TOOLBAR)]
      .filter((b) => b.disabled)
      .map((b) => b.id);
    expect(greyBar).toEqual([]);
  });

  /**
   * …and the row is a real checkable one now, not a label with an icon: it
   * must carry the toggle's own checked state and fire the handler, which is
   * what tells the menu apart from the greyed placeholder it replaced.
   */
  it('makes Show with Forced Opacity Mode a live checkable row', () => {
    const row = menu('View').items.find((i) => i.label === 'Show with Forced Opacity Mode');
    expect(row?.disabled).toBeUndefined();
    expect(row?.action).toBeTypeOf('function');
    expect(row?.checked).toBe(false);
  });
});
