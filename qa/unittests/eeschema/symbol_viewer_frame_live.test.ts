// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SYMBOL_VIEWER_FRAME on the live model (eeschema/symbol_viewer_frame.cpp): the library and symbol
 * lists, their filters, the selection, the preview with its unit and body style, the keys, and
 * the browser's half of SYMBOL_EDITOR_CONTROL. Every expectation is read off the C++ at the line
 * named beside it.
 */
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { SYMBOL_VIEWER_FRAME } from '@ziroeda/eeschema/symbol_viewer_frame.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { LIB_TREE_ITEM_SYMBOL, type LibTreeItem } from '@ziroeda/eeschema/lib_tree_item.js';
import { SYMBOL_TYPE } from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { SymbolLibAdapter } from '@ziroeda/eeschema/project_sch.js';
import { GRID_STYLE } from '@ziroeda/common/gal/gal_display_options.js';
import {
  EESCHEMA_DEFAULTS,
  type EeschemaSettings,
  eeschemaKifaceSettings,
  setEeschemaSettingsProvider,
  setUpdateEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type SYMBOL_VIEWER_HARNESS,
  symbolViewerHarness,
} from './support/symbol_viewer_harness.js';

let t: SYMBOL_VIEWER_HARNESS;

afterEach(() => {
  t.dispose();
  SetErrorPresenter(() => {});
});

const libs = () => t.frame.m_libList.GetStrings();
const symbols = () => t.frame.m_symbolList.GetStrings();
const current = () => SYMBOL_VIEWER_FRAME.m_currentSymbol.Format();

/** The user clicks a row, as EVT_LISTBOX reaches ClickOnLibList / ClickOnSymbolList. */
const clickLib = (aName: string) => {
  t.frame.m_libList.SetSelection(t.frame.m_libList.FindString(aName));
  t.frame.ClickOnLibList();
};
const clickSymbol = (aName: string) => {
  t.frame.m_symbolList.SetSelection(t.frame.m_symbolList.FindString(aName));
  t.frame.ClickOnSymbolList();
};

describe('ReCreateLibList (:478)', () => {
  it('lists every library and, with none current, makes the first one current', () => {
    t = symbolViewerHarness();

    expect(libs()).toEqual(['Alpha', 'Beta']);
    expect(current()).toBe('Alpha:');
    expect(symbols()).toEqual(['R', 'U']);
    // No symbol name to find: ReCreateSymbolList selects nothing (:671-679).
    expect(t.frame.m_symbolList.GetSelection()).toBe(-1);
  });

  it('puts a pinned library first, marked, and still finds it by its plain name', () => {
    t = symbolViewerHarness();
    // project.m_PinnedSymbolLibs (:496)
    t.frame.Prj().GetProjectFile().m_PinnedSymbolLibs.push('Beta');
    t.frame.ReCreateLibList();

    expect(libs()).toEqual([`${PINNING_SYMBOL}Beta`, 'Alpha']);
    expect(t.frame.m_libList.FindString('Beta')).toBe(0);
    expect(t.frame.m_libList.GetBaseString(0)).toBe('Beta');
  });

  it('filters by library name, and moves to the first one listed when the current one is gone', () => {
    t = symbolViewerHarness();
    t.frame.m_libFilter.SetValue('bet');

    expect(libs()).toEqual(['Beta']);
    expect(current()).toBe('Beta:');
    expect(symbols()).toEqual(['GND', 'Q']);
  });

  it('with the power filter on, lists only libraries that have a power symbol', () => {
    t = symbolViewerHarness();
    t.frame.m_listPowerOnly = true;
    t.frame.ReCreateLibList();

    expect(libs()).toEqual(['Beta']);
  });

  it('with an allowed-libraries list, lists only those', () => {
    t = symbolViewerHarness();
    t.frame.m_allowedLibs = ['Alpha'];
    t.frame.ReCreateLibList();

    expect(libs()).toEqual(['Alpha']);
  });
});

describe('ReCreateSymbolList (:606)', () => {
  it('requires every term: name, description and keywords all count', () => {
    t = symbolViewerHarness();

    t.frame.m_symbolFilter.SetValue('passive');
    expect(symbols()).toEqual(['R']);

    t.frame.m_symbolFilter.SetValue('gate');
    expect(symbols()).toEqual(['U']);

    t.frame.m_symbolFilter.SetValue('passive gate');
    expect(symbols()).toEqual([]);
  });

  /**
   * GetPinCount is cachePinCount's: the graphical pins of every unit at body style 1
   * (lib_symbol.cpp:1276). U has one pin in each unit, so two, like R; Q has three, GND one.
   */
  it('matches a number against the pin count', () => {
    t = symbolViewerHarness();

    t.frame.m_symbolFilter.SetValue('2');
    expect(symbols()).toEqual(['R', 'U']);

    t.frame.m_symbolFilter.SetValue('4');
    expect(symbols()).toEqual([]);

    clickLib('Beta');
    t.frame.m_symbolFilter.SetValue('3');
    expect(symbols()).toEqual(['Q']);
  });

  it('an emptied list clears the symbol and its unit and body style', () => {
    t = symbolViewerHarness();
    clickSymbol('U');
    t.frame.SetUnitAndBodyStyle(2, 2);

    t.frame.m_symbolFilter.SetValue('nothing-matches-this');

    expect(current()).toBe('Alpha:');
    expect([t.frame.GetUnit(), t.frame.GetBodyStyle()]).toEqual([1, 1]);
  });
});

describe('selecting a symbol', () => {
  it('previews it flattened, with its name, parent, description and keywords', () => {
    t = symbolViewerHarness();
    clickSymbol('R');

    expect(current()).toBe('Alpha:R');
    expect(t.frame.m_previewItem?.GetName()).toBe('R');
    expect(t.frame.GetMsgPanelItems().map((i) => [i.GetUpperText(), i.GetLowerText()])).toEqual([
      ['Name', 'R'],
      ['Parent', ''],
      ['Description', 'Resistor'],
      ['Keywords', 'res passive'],
    ]);
  });

  it('a library click keeps the symbol only if the new library has one of that name', () => {
    t = symbolViewerHarness();
    clickSymbol('R');
    clickLib('Beta');

    expect(current()).toBe('Beta:');
    expect(t.frame.m_libList.GetStringSelection()).toBe('Beta');
  });

  it('puts the library in the title (:1043)', () => {
    t = symbolViewerHarness();
    clickLib('Beta');

    expect(t.titles.at(-1)).toBe('/libs/Beta.kicad_sym — Symbol Library Browser');
  });

  it('Show Datasheet is live only for a symbol with a datasheet (:316-321)', () => {
    t = symbolViewerHarness();
    clickSymbol('U');
    expect(t.frame.ConditionShowDatasheet()).toBe(false);

    clickSymbol('R');
    expect(t.frame.ConditionShowDatasheet()).toBe(true);
  });
});

describe('units and body styles', () => {
  it('fills the unit and body style choices for the symbol, and greys them for one of each', () => {
    t = symbolViewerHarness();
    clickSymbol('U');

    expect(t.frame.m_unitChoice.GetStrings()).toEqual(['Unit A', 'Unit B']);
    expect(t.frame.m_unitChoice.IsEnabled()).toBe(true);
    expect(t.frame.m_bodyStyleChoice.GetStrings()).toEqual(['Standard', 'Alternate']);

    clickSymbol('R');

    expect(t.frame.m_unitChoice.GetStrings()).toEqual([]);
    expect(t.frame.m_unitChoice.IsEnabled()).toBe(false);
    expect(t.frame.m_bodyStyleChoice.IsEnabled()).toBe(false);
  });

  it('picking unit B shows unit B, and Zoom to Fit fits it', () => {
    t = symbolViewerHarness();
    clickSymbol('U');
    const unitA = t.frame.GetDocumentExtents().GetWidth();

    t.frame.m_unitChoice.SetSelection(1);
    t.frame.onSelectSymbolUnit();

    expect(t.frame.GetUnit()).toBe(2);
    expect(t.frame.GetRenderSettings()!.m_ShowUnit).toBe(2);
    expect(t.frame.GetDocumentExtents().GetWidth()).toBeGreaterThan(unitA);
  });

  it('picking Alternate shows body style 2', () => {
    t = symbolViewerHarness();
    clickSymbol('U');

    t.frame.m_bodyStyleChoice.SetSelection(1);
    t.frame.onSelectSymbolBodyStyle();

    expect(t.frame.GetBodyStyle()).toBe(2);
    expect(t.frame.GetRenderSettings()!.m_ShowBodyStyle).toBe(2);
  });

  it('a different symbol picked by the user starts again at unit 1 (:770-775)', () => {
    t = symbolViewerHarness();
    clickSymbol('U');
    t.frame.m_unitChoice.SetSelection(1);
    t.frame.onSelectSymbolUnit();

    clickSymbol('R');
    clickSymbol('U');

    expect(t.frame.GetUnit()).toBe(1);
  });

  it('with no symbol, the extents are a 400 IU square at the origin (:891)', () => {
    t = symbolViewerHarness();
    const box = t.frame.GetDocumentExtents();

    expect([box.GetX(), box.GetY(), box.GetWidth(), box.GetHeight()]).toEqual([
      -200, -200, 400, 400,
    ]);
  });
});

describe('next and previous', () => {
  it('step through the symbol list and stop at its ends (:989-1015)', () => {
    t = symbolViewerHarness();
    clickSymbol('R');

    t.frame.SelectNextSymbol();
    expect(current()).toBe('Alpha:U');
    t.frame.SelectNextSymbol();
    expect(current()).toBe('Alpha:U');

    t.frame.SelectPreviousSymbol();
    expect(current()).toBe('Alpha:R');
    t.frame.SelectPreviousSymbol();
    expect(current()).toBe('Alpha:R');
    // The list keeps its row: stepping back from the first one does not deselect it.
    expect(t.frame.m_symbolList.GetStringSelection()).toBe('R');
  });

  it('are the browser actions SYMBOL_EDITOR_CONTROL binds (:1057-1058)', () => {
    t = symbolViewerHarness();
    clickSymbol('R');

    t.frame.GetToolManager()!.RunAction(SCH_ACTIONS.nextSymbol);
    expect(current()).toBe('Alpha:U');

    t.frame.GetToolManager()!.RunAction(SCH_ACTIONS.previousSymbol);
    expect(current()).toBe('Alpha:R');
  });
});

describe('OnCharHook (:920)', () => {
  it('Down in the library list or its filter moves to the next library', () => {
    t = symbolViewerHarness();
    t.frame.m_libList.SetSelection(0);
    t.frame.m_libList.SetHasFocus(true);

    expect(t.frame.OnCharHook('ArrowDown')).toBe(true);
    expect(current()).toBe('Beta:');
  });

  it('Up in the library list moves to the previous library, and stops at the first', () => {
    t = symbolViewerHarness();
    clickLib('Beta');
    t.frame.m_libList.SetHasFocus(true);

    expect(t.frame.OnCharHook('ArrowUp')).toBe(true);
    expect(current()).toBe('Alpha:');

    expect(t.frame.OnCharHook('ArrowUp')).toBe(true);
    expect(current()).toBe('Alpha:');
  });

  it('Down anywhere else moves to the next symbol, Up to the previous', () => {
    t = symbolViewerHarness();
    clickSymbol('R');
    t.frame.m_symbolList.SetHasFocus(false);

    t.frame.OnCharHook('ArrowDown');
    expect(current()).toBe('Alpha:U');

    t.frame.OnCharHook('ArrowUp');
    expect(current()).toBe('Alpha:R');
  });

  it('Tab goes from the library filter to the symbol filter, Shift+Tab back', () => {
    t = symbolViewerHarness();
    t.frame.m_libFilter.SetHasFocus(true);

    expect(t.frame.OnCharHook('Tab')).toBe(true);
    expect(t.frame.m_symbolFilter.TakeFocusRequest()).toBe(true);

    t.frame.m_libFilter.SetHasFocus(false);
    expect(t.frame.OnCharHook('Tab', true)).toBe(true);
    expect(t.frame.m_libFilter.TakeFocusRequest()).toBe(true);

    // Shift+Tab out of the library filter, and Tab out of the symbol one, are skipped.
    expect(t.frame.OnCharHook('Tab', true)).toBe(false);
  });

  it('Enter on a selected symbol places it: with no schematic open, says so', () => {
    const errors: string[] = [];
    SetErrorPresenter((aMessage) => errors.push(aMessage));
    t = symbolViewerHarness();
    clickSymbol('R');

    expect(t.frame.OnCharHook('Enter')).toBe(true);
    expect(errors).toEqual(['No schematic currently open.']);
  });

  it('any other key is skipped', () => {
    t = symbolViewerHarness();

    expect(t.frame.OnCharHook('a')).toBe(false);
  });
});

describe('KiwayMailIn (:1067)', () => {
  it('MAIL_RELOAD_LIB re-lists the libraries', () => {
    t = symbolViewerHarness();
    t.frame.m_allowedLibs = ['Beta'];

    t.frame.KiwayMailIn(
      new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH_VIEWER, MAIL_T.MAIL_RELOAD_LIB, { value: '' }),
    );

    expect(libs()).toEqual(['Beta']);
  });

  it("MAIL_REFRESH_SYMBOL rebuilds the preview only when it names the shown symbol's library", () => {
    t = symbolViewerHarness();
    clickSymbol('R');
    const before = t.frame.m_previewItem;

    const mail = (aLib: string) =>
      t.frame.KiwayMailIn(
        new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH_VIEWER, MAIL_T.MAIL_REFRESH_SYMBOL, { value: aLib }),
      );

    mail('/libs/Beta.kicad_sym');
    // Identity as a boolean: a failed toBe on two LIB_SYMBOLs diffs them whole and runs out of heap.
    expect(t.frame.m_previewItem === before).toBe(true);

    mail('/libs/Alpha.kicad_sym');
    expect(t.frame.m_previewItem === before).toBe(false);
    expect(t.frame.m_previewItem?.GetName()).toBe('R');
  });
});

describe('LoadSettings / SaveSettings (:791-839)', () => {
  let stored: EeschemaSettings;

  afterEach(() => {
    setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
    setUpdateEeschemaSettingsProvider(() => {});
  });

  const useSettings = (aLibView: Partial<EeschemaSettings['lib_view']>) => {
    stored = structuredClone({
      ...EESCHEMA_DEFAULTS,
      lib_view: { ...EESCHEMA_DEFAULTS.lib_view, ...aLibView },
    });
    setEeschemaSettingsProvider(() => stored);
    setUpdateEeschemaSettingsProvider((mutate) => {
      const next = structuredClone(stored);
      mutate(next);
      stored = next;
    });
  };

  const sized = (aWidth: number) => ({
    ...structuredClone(EESCHEMA_DEFAULTS.lib_view.window),
    size_x: aWidth,
  });

  /**
   * lib_view.window is addParamsForWindow's 500 x 400 (eeschema_settings.cpp:644), so on a first run
   * the clamp's limit is 500 - 80 and lists of 120 + 180 stand.
   */
  it('reads lib_view, and keeps the widths that fit the default 500-wide window', () => {
    useSettings({ lib_list_width: 120, cmp_list_width: 180, show_pin_electrical_type: false });
    t = symbolViewerHarness();
    t.frame.LoadSettings(eeschemaKifaceSettings());

    expect(t.frame.GetRenderSettings()!.m_ShowPinsElectricalType).toBe(false);
    expect([t.frame.m_libListWidth, t.frame.m_symbolListWidth]).toEqual([120, 180]);
  });

  it('clamps them to a narrower saved window, in ints as upstream does', () => {
    useSettings({ lib_list_width: 120, cmp_list_width: 180, window: sized(280) });
    t = symbolViewerHarness();
    t.frame.LoadSettings(eeschemaKifaceSettings());

    // maxWidth 200: 200 * ( 120 / 300 ) is 200 * 0 in ints, and the symbol list takes the rest.
    expect([t.frame.m_libListWidth, t.frame.m_symbolListWidth]).toEqual([0, 200]);
  });

  it("keeps its own window settings, lib_view.window, not the schematic editor's", () => {
    const own = sized(500);
    // An index of its four grids (COMMON_TOOLS clamps one past them, as upstream's does), and not
    // the schematic editor's.
    own.grid.last_size_idx = 2;
    useSettings({ window: own });
    t = symbolViewerHarness();
    const cfg = eeschemaKifaceSettings();

    expect(t.frame.GetWindowSettings(cfg) === cfg.m_LibViewPanel.window).toBe(true);
    expect(cfg.m_LibViewPanel.window.grid.last_size_idx).toBe(2);
    expect(cfg.m_Window.grid.last_size_idx).not.toBe(2);
  });

  /**
   * show_pin_numbers is in PANEL_LIB_VIEW but registered as no PARAM, and `m_LibViewPanel()`
   * value-initialises it (eeschema_settings.cpp:187): false at start, then whatever the browser
   * last saved into the settings object, for as long as the program runs - never in the file.
   */
  it('opens without pin numbers, and remembers the toggle for the session only', () => {
    useSettings({});
    t = symbolViewerHarness();
    const cfg = eeschemaKifaceSettings();
    t.frame.LoadSettings(cfg);

    expect(t.frame.GetRenderSettings()!.m_ShowPinNumbers).toBe(false);
    expect(t.frame.ConditionPinNumbersShown()).toBe(false);

    t.frame.GetToolManager()!.RunAction(SCH_ACTIONS.showPinNumbers);
    t.frame.SaveSettings(cfg);
    t.frame.GetRenderSettings()!.m_ShowPinNumbers = false;
    t.frame.LoadSettings(eeschemaKifaceSettings());

    expect(t.frame.GetRenderSettings()!.m_ShowPinNumbers).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('show_pin_numbers');
  });

  it('writes the widths, the electrical-type toggle and its window back', () => {
    useSettings({ lib_list_width: 150, cmp_list_width: 150, show_pin_electrical_type: true });
    t = symbolViewerHarness();
    t.frame.m_libListWidth = 210;
    t.frame.m_symbolListWidth = 320;
    t.frame.GetRenderSettings()!.m_ShowPinsElectricalType = false;
    t.frame.GetGalDisplayOptions().m_gridStyle = GRID_STYLE.LINES;

    t.frame.SaveSettings(eeschemaKifaceSettings());

    expect([
      stored.lib_view.lib_list_width,
      stored.lib_view.cmp_list_width,
      stored.lib_view.show_pin_electrical_type,
    ]).toEqual([210, 320, false]);
    expect(stored.lib_view.window.grid.style).toBe('lines');
    expect(stored.window.grid.style).toBe(EESCHEMA_DEFAULTS.window.grid.style);
  });

  /**
   * `if( m_libListWidth && m_libList ) m_libListWidth = m_libList->GetSize().x;` and
   * `m_symbolListWidth = m_symbolList->GetSize().x;` (:822-825): the lists as the window drew them,
   * except a library list LoadSettings clamped to nothing, which stays nothing.
   */
  it('records the widths the window drew the lists at', () => {
    useSettings({});
    const drawn = new Map<unknown, number>();
    t = symbolViewerHarness({ getListWidth: (aList) => drawn.get(aList) ?? -1 });
    drawn.set(t.frame.m_libList, 240).set(t.frame.m_symbolList, 360);
    t.frame.m_libListWidth = 1;

    t.frame.SaveSettings(eeschemaKifaceSettings());
    expect([stored.lib_view.lib_list_width, stored.lib_view.cmp_list_width]).toEqual([240, 360]);

    t.frame.m_libListWidth = 0;
    t.frame.SaveSettings(eeschemaKifaceSettings());
    expect([stored.lib_view.lib_list_width, stored.lib_view.cmp_list_width]).toEqual([0, 360]);
  });

  /**
   * EDA_BASE_FRAME::SaveSettings -> SaveWindowSettings (eda_base_frame.cpp:1229-1300): the size the
   * frame was shown at goes into its window block, so the next LoadSettings clamps the lists
   * against the real window, not addParamsForWindow's 500.
   */
  it('saves the size it was shown at, which the next open measures the lists against', () => {
    useSettings({ lib_list_width: 200, cmp_list_width: 300 });
    t = symbolViewerHarness();

    // Without a size the window block keeps its 500, and 200 + 300 does not fit 500 - 80.
    t.frame.SaveSettings(eeschemaKifaceSettings());
    expect(stored.lib_view.window.size_x).toBe(500);

    t.frame.SetWindowSizeSource(() => ({ x: 1200, y: 800 }));
    t.frame.m_libListWidth = 200;
    t.frame.m_symbolListWidth = 300;
    t.frame.SaveSettings(eeschemaKifaceSettings());

    expect([stored.lib_view.window.size_x, stored.lib_view.window.size_y]).toEqual([1200, 800]);
    expect(stored.window).toEqual(EESCHEMA_DEFAULTS.window);

    t.frame.LoadSettings(eeschemaKifaceSettings());
    expect([t.frame.m_libListWidth, t.frame.m_symbolListWidth]).toEqual([200, 300]);
  });
});

/**
 * A hosted library: a folder of one file per symbol, fetched on use, whose symbols the program
 * keeps as preloaded items. The window answers getLibraryNames / getSymbols from those items (the
 * chooser's own source) and ensureSymbol by fetching the one file; the frame's ReCreate* and its
 * preview run unchanged over them.
 */
describe('a hosted library (items preloaded, files fetched on use)', () => {
  const ITEMS: LibTreeItem[] = [
    {
      name: 'OPAMP',
      description: 'Dual operational amplifier',
      keywords: 'amp',
      footprint: '',
      isPower: false,
      isRoot: true,
      pinCount: 8,
      unitCount: 3,
      chooserFields: [],
    },
    {
      name: 'REG',
      description: 'Linear regulator',
      keywords: 'ldo',
      footprint: '',
      isPower: false,
      isRoot: true,
      pinCount: 3,
      unitCount: 1,
      chooserFields: [],
    },
  ];

  const REG_FILE = `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")
  (symbol "REG" (in_bom yes) (on_board yes)
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "REG" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Description" "Linear regulator" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "REG_1_1" (rectangle (start -5.08 -2.54) (end 5.08 2.54) (stroke (width 0) (type default)) (fill (type none))))))`;

  let ensured: string[];
  /** Releases the fetches in flight - the file arrives only when the test says so. */
  let arrive: () => void;
  /** Whether the next fetch fails, as an offline one does. */
  let failNext: boolean;

  const hosted = () => {
    ensured = [];
    failNext = false;
    let gate = new Promise<void>((r) => (arrive = r));
    t = symbolViewerHarness({
      getLibraryNames: () => [...SymbolLibAdapter(null).GetLibraryNames(), 'Gamma'],
      getSymbols: (aLib, aType) =>
        aLib === 'Gamma'
          ? ITEMS.filter((i) => aType !== SYMBOL_TYPE.POWER_ONLY || i.isPower).map(
              (i) => new LIB_TREE_ITEM_SYMBOL('Gamma', i),
            )
          : undefined,
      ensureSymbol: async (aLibId) => {
        ensured.push(aLibId.Format());
        await gate;
        gate = new Promise<void>((r) => (arrive = r));
        if (failNext) {
          failNext = false;
          return false;
        }
        t.fs.Write(
          `Gamma/${aLibId.GetLibItemName()}.kicad_sym`,
          new TextEncoder().encode(REG_FILE),
        );
        SymbolLibAdapter(null).LoadOne('Gamma');
        return true;
      },
    }, () => {}, ['Gamma']);
  };

  it('lists it, and its symbols from the items', () => {
    hosted();
    expect(libs()).toEqual(['Alpha', 'Beta', 'Gamma']);

    clickLib('Gamma');
    expect(symbols()).toEqual(['OPAMP', 'REG']);
  });

  it("filters its symbols on the items' descriptions, keywords and pin counts", () => {
    hosted();
    clickLib('Gamma');

    t.frame.m_symbolFilter.SetValue('regulator');
    expect(symbols()).toEqual(['REG']);

    t.frame.m_symbolFilter.SetValue('amp');
    expect(symbols()).toEqual(['OPAMP']);

    t.frame.m_symbolFilter.SetValue('8');
    expect(symbols()).toEqual(['OPAMP']);
  });

  it('leaves it out of a power-only list when none of its items is power', () => {
    hosted();
    t.frame.m_listPowerOnly = true;
    t.frame.ReCreateLibList();

    expect(libs()).toEqual(['Beta']);
  });

  it("fetches the clicked symbol's file, once, then previews it", async () => {
    hosted();
    clickLib('Gamma');
    clickSymbol('REG');

    expect(t.frame.m_previewItem).toBeNull();
    expect(ensured).toEqual(['Gamma:REG']);

    // Another preview while the file is on its way (a unit pick, an activation) does not fetch again.
    t.frame.updatePreviewSymbol();
    expect(t.frame.m_previewItem).toBeNull();
    expect(ensured).toEqual(['Gamma:REG']);

    arrive();
    await new Promise((r) => setTimeout(r, 0));

    expect(t.frame.m_previewItem?.GetName()).toBe('REG');
    expect(ensured).toEqual(['Gamma:REG']);
  });

  it('fetches again after a fetch that failed', async () => {
    hosted();
    failNext = true;
    clickLib('Gamma');
    clickSymbol('REG');
    arrive();
    await new Promise((r) => setTimeout(r, 0));

    expect(t.frame.m_previewItem).toBeNull();

    t.frame.updatePreviewSymbol();
    expect(ensured).toEqual(['Gamma:REG', 'Gamma:REG']);

    arrive();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.frame.m_previewItem?.GetName()).toBe('REG');
  });

  it('drops a fetch the browser has moved on from', async () => {
    hosted();
    clickLib('Gamma');
    clickSymbol('REG');
    clickLib('Alpha');
    clickSymbol('R');

    arrive();
    await new Promise((r) => setTimeout(r, 0));

    expect(t.frame.m_previewItem?.GetName()).toBe('R');
  });
});
