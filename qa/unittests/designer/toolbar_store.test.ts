// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOLBAR_SETTINGS`: the stored form of a toolbar, and the two conversions
 * between it and the entries the renderer draws.
 *
 * This is the half of Preferences > Toolbars that has nothing to do with the
 * panel. A customisation page is only worth anything if what it writes survives
 * a reload and is what the frame then reads, so the three things pinned here
 * are: the JSON keys are KiCad's own; a default toolbar survives a round trip
 * through them unchanged; and `GetToolbarConfig`'s two-way choice between
 * stored and default is made on `custom_toolbars`.
 *
 * The expectations are the editors' own toolbar modules and the C++, never a
 * value produced by the code under test.
 */
import { describe, it, expect } from 'vitest';
import {
  configFromEntries,
  entriesFromConfig,
  normalizeToolbarSettings,
  resolveToolbarConfig,
  setStoredToolbarConfig,
  storedToolbarConfig,
  toolbarControlNames,
  toolbarLocsOf,
  toolbarTemplates,
  TOOLBAR_ITEM_TYPES,
  TOOLBAR_LOCS,
  TOOLBAR_LOC_NAMES,
  type ToolbarDefaults,
  type ToolbarSettings,
} from '@ziroeda/designer/src/ui/toolbar_config.js';
import {
  DS_DEFAULT_TOOLBARS,
  DS_LEFT_TOOLBAR,
  DS_RIGHT_TOOLBAR,
  DS_TOP_TOOLBAR,
} from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { SCH_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import { PCB_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import type { ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';
import {
  EESCHEMA_DEFAULTS,
  PCBNEW_DEFAULTS,
  PL_EDITOR_DEFAULTS,
  SYMBOL_EDITOR_DEFAULTS,
  TOOLBAR_APPS,
  toolbarSlice,
} from '@ziroeda/designer/src/prefs/settings.js';

// ----------------------------------------------------------- where it is stored

describe('the store is a file per app, off by default', () => {
  it('is named as KiCad names the file', () => {
    // `GetToolbarSettings<PL_EDITOR_TOOLBAR_SETTINGS>( "pl_editor-toolbars" )`
    // (`pagelayout_editor/pl_editor.cpp:88`), and the same shape in
    // `eeschema/eeschema.cpp:346` and `pcbnew/pcbnew.cpp:455`. A slice named
    // for the app alone would write the toolbars into that app's OWN settings
    // file and take the rest of it with them.
    expect(TOOLBAR_APPS.map(toolbarSlice)).toEqual([
      'eeschema-toolbars',
      // `GetToolbarSettings<SYMBOL_EDIT_TOOLBAR_SETTINGS>( "symbol_editor-toolbars" )`
      // (`eeschema/eeschema.cpp:289`) — one KIFACE, two toolbar files, because
      // the Symbol Editor is its own frame with its own bars.
      'symbol_editor-toolbars',
      'pcbnew-toolbars',
      'pl_editor-toolbars',
      // `GetToolbarSettings<GERBVIEW_TOOLBAR_SETTINGS>( "gerbview-toolbars" )`
      // (`gerbview/gerbview.cpp:99`).
      'gerbview-toolbars',
      // The two frames that had no file at all until the Footprint Editor and
      // the 3D Viewer got their pages: `pcbnew.cpp:384` and `:484`. Upstream
      // builds `PANEL_TOOLBAR_CUSTOMIZATION` for SEVEN frames, and these were
      // the missing two — both drew their toolbars from a module constant, so
      // there was nothing for a page to change.
      'fpedit-toolbars',
      '3d_viewer-toolbars',
    ]);
  });

  it('has custom_toolbars off in every app', () => {
    // `m_params.emplace_back( new PARAM<bool>( "appearance.custom_toolbars",
    // &m_CustomToolbars, false ) )` (`common/settings/app_settings.cpp:285`).
    //
    // Nothing else here can see this: with no configuration stored, both
    // settings draw `DefaultToolbarConfig`, so a default of `true` is invisible
    // everywhere except on the page itself -- where it would open with
    // "Customize toolbars" already ticked, which a live KiCad does not.
    expect(EESCHEMA_DEFAULTS.appearance.custom_toolbars).toBe(false);
    expect(SYMBOL_EDITOR_DEFAULTS.appearance.custom_toolbars).toBe(false);
    expect(PCBNEW_DEFAULTS.appearance.custom_toolbars).toBe(false);
    expect(PL_EDITOR_DEFAULTS.appearance.custom_toolbars).toBe(false);
  });
});

// ------------------------------------------------------------------ the enums

describe('the two enums are KiCad’s, spelled as KiCad writes them', () => {
  it('TOOLBAR_LOC is in declaration order', () => {
    // `toolbar_configuration.h:266-272`. The order is what
    // `magic_enum::enum_values<TOOLBAR_LOC>()` yields, which is the order both
    // `ResetPanel` and `TransferDataToWindow` fill the "Toolbar:" choice in
    // (`panel_toolbar_customization.cpp:243`, `:277`).
    expect([...TOOLBAR_LOCS]).toEqual(['LEFT', 'RIGHT', 'TOP_MAIN', 'TOP_AUX']);
  });

  it('TOOLBAR_ITEM_TYPE is in declaration order', () => {
    // `toolbar_configuration.h:37-44`.
    expect([...TOOLBAR_ITEM_TYPES]).toEqual(['TOOL', 'TB_GROUP', 'SPACER', 'CONTROL', 'SEPARATOR']);
  });

  it('names the four toolbars as s_toolbarNameMap does', () => {
    // `panel_toolbar_customization.cpp:51-56` — sentence case, and "Top main" /
    // "Top auxiliary" rather than the enum spellings.
    expect(TOOLBAR_LOC_NAMES).toEqual({
      LEFT: 'Left',
      RIGHT: 'Right',
      TOP_MAIN: 'Top main',
      TOP_AUX: 'Top auxiliary',
    });
  });
});

// ------------------------------------------------- which toolbars each app has

describe('each app’s DefaultToolbarConfig answers for the toolbars KiCad gives it', () => {
  it('pl_editor has three: TOP_AUX is std::nullopt', () => {
    // `toolbars_pl_editor.cpp:40-43` — the switch's first case is
    // `case TOOLBAR_LOC::TOP_AUX: return std::nullopt;`.
    expect(toolbarLocsOf(DS_DEFAULT_TOOLBARS)).toEqual(['LEFT', 'RIGHT', 'TOP_MAIN']);
  });

  it('eeschema has three: TOP_AUX is std::nullopt', () => {
    // `toolbars_sch_editor.cpp:67-68`, the same first case.
    expect(toolbarLocsOf(SCH_DEFAULT_TOOLBARS)).toEqual(['LEFT', 'RIGHT', 'TOP_MAIN']);
  });

  it('pcbnew has all four', () => {
    // `toolbars_pcb_editor.cpp:148`, `:212`, `:302`, `:365` — pcbnew is the one
    // editor here whose TOP_AUX is a real toolbar and not a nullopt.
    expect(toolbarLocsOf(PCB_DEFAULT_TOOLBARS)).toEqual(['LEFT', 'RIGHT', 'TOP_MAIN', 'TOP_AUX']);
  });

  it('points each location at that editor’s own list, not another’s', () => {
    expect(DS_DEFAULT_TOOLBARS.TOP_MAIN).toBe(DS_TOP_TOOLBAR);
    expect(DS_DEFAULT_TOOLBARS.LEFT).toBe(DS_LEFT_TOOLBAR);
    expect(DS_DEFAULT_TOOLBARS.RIGHT).toBe(DS_RIGHT_TOOLBAR);
  });
});

// ----------------------------------------------------------------- the JSON

describe('a toolbar serialises with KiCad’s own keys', () => {
  it('writes pl_editor’s LEFT toolbar exactly as to_json would', () => {
    // `toolbars_pl_editor.cpp:45-59`:
    //     config.AppendAction( ACTIONS::toggleGrid )
    //           .AppendGroup( TOOLBAR_GROUP_CONFIG( _( "Units" ) )
    //                         .AddAction( ACTIONS::millimetersUnits )
    //                         .AddAction( ACTIONS::inchesUnits )
    //                         .AddAction( ACTIONS::milsUnits ) );
    // and `to_json` (`toolbar_configuration.cpp:35-68`) gives a TOOL its
    // `name`, a TB_GROUP its `group_name` and `group_items`, and a SEPARATOR
    // nothing but `type`.
    expect(configFromEntries(DS_LEFT_TOOLBAR)).toEqual([
      { type: 'TOOL', name: 'toggleGrid' },
      {
        type: 'TB_GROUP',
        group_name: 'Units',
        group_items: [
          { type: 'TOOL', name: 'unitsMm' },
          { type: 'TOOL', name: 'unitsInches' },
          { type: 'TOOL', name: 'unitsMils' },
        ],
      },
    ]);
  });

  it('writes a separator as type alone', () => {
    // `case TOOLBAR_ITEM_TYPE::SEPARATOR: // Nothing to add for a separator`.
    const right = configFromEntries(DS_RIGHT_TOOLBAR);
    expect(right[1]).toEqual({ type: 'SEPARATOR' });
    expect(Object.keys(right[1] as object)).toEqual(['type']);
  });

  it('writes a spacer’s pixel size and a control’s name', () => {
    // `aJson["size"] = aItem.m_Size;` and `aJson["name"] = aItem.m_ControlName;`.
    expect(configFromEntries([{ spacer: 5 }, { control: 'gridSelect' }])).toEqual([
      { type: 'SPACER', size: 5 },
      { type: 'CONTROL', name: 'gridSelect' },
    ]);
  });
});

describe('reading a stored file back', () => {
  it('takes the location names case-insensitively, as magic_enum does', () => {
    // `magic_enum::enum_cast<TOOLBAR_LOC>( …, magic_enum::case_insensitive )`
    // (`toolbar_configuration.cpp:180-181`).
    const s = normalizeToolbarSettings({
      toolbars: [{ name: 'top_main', contents: [{ type: 'separator' }] }],
    });
    expect(s.toolbars).toEqual([{ name: 'TOP_MAIN', contents: [{ type: 'SEPARATOR' }] }]);
  });

  it('drops a location it does not know', () => {
    const s = normalizeToolbarSettings({ toolbars: [{ name: 'BOTTOM', contents: [] }] });
    expect(s.toolbars).toEqual([]);
  });

  it('keeps the first of two entries for one location', () => {
    // `m_toolbars.emplace` on a std::map does not overwrite.
    const s = normalizeToolbarSettings({
      toolbars: [
        { name: 'LEFT', contents: [{ type: 'TOOL', name: 'first' }] },
        { name: 'LEFT', contents: [{ type: 'TOOL', name: 'second' }] },
      ],
    });
    expect(s.toolbars).toHaveLength(1);
    expect(s.toolbars[0]?.contents).toEqual([{ type: 'TOOL', name: 'first' }]);
  });

  it('treats an item with an unknown type as a TOOL', () => {
    // `TOOLBAR_ITEM()` inits `m_Type( TOOLBAR_ITEM_TYPE::TOOL )` and `from_json`
    // only overwrites it when the cast succeeds.
    const s = normalizeToolbarSettings({
      toolbars: [{ name: 'LEFT', contents: [{ type: 'WIDGET', name: 'toggleGrid' }] }],
    });
    expect(s.toolbars[0]?.contents).toEqual([{ type: 'TOOL', name: 'toggleGrid' }]);
  });

  it('survives every shape of rubbish', () => {
    for (const junk of [undefined, null, 42, 'x', {}, { toolbars: 3 }, { toolbars: [null, 7] }])
      expect(normalizeToolbarSettings(junk)).toEqual({ toolbars: [] });
  });

  it('round-trips a stored configuration through JSON', () => {
    const store: ToolbarSettings = { toolbars: [] };
    setStoredToolbarConfig(store, 'TOP_MAIN', configFromEntries(DS_TOP_TOOLBAR));
    const reloaded = normalizeToolbarSettings(JSON.parse(JSON.stringify(store)));
    expect(reloaded).toEqual(store);
    expect(storedToolbarConfig(reloaded, 'TOP_MAIN')).toEqual(configFromEntries(DS_TOP_TOOLBAR));
    expect(storedToolbarConfig(reloaded, 'LEFT')).toBeUndefined();
  });

  it('replaces rather than appends when a location is stored twice', () => {
    const store: ToolbarSettings = { toolbars: [] };
    setStoredToolbarConfig(store, 'LEFT', [{ type: 'TOOL', name: 'a' }]);
    setStoredToolbarConfig(store, 'LEFT', [{ type: 'TOOL', name: 'b' }]);
    expect(store.toolbars).toHaveLength(1);
    expect(storedToolbarConfig(store, 'LEFT')).toEqual([{ type: 'TOOL', name: 'b' }]);
  });
});

// -------------------------------------------------------------- the round trip

const APPS: [string, ToolbarDefaults][] = [
  ['pl_editor', DS_DEFAULT_TOOLBARS],
  ['eeschema', SCH_DEFAULT_TOOLBARS],
  ['pcbnew', PCB_DEFAULT_TOOLBARS],
];

describe('a default toolbar survives being stored and read back', () => {
  // The whole customisation mechanism rests on this: `TransferDataFromWindow`
  // writes every toolbar back on OK, changed or not, so merely opening the page
  // and pressing OK must not alter a single button.
  it.each(APPS)('%s', (_app, defaults) => {
    for (const loc of toolbarLocsOf(defaults)) {
      const entries = defaults[loc] as ToolEntry[];
      const back = entriesFromConfig(configFromEntries(entries), defaults);
      expect(back, loc).toEqual(entries);
    }
  });
});

describe('materialising a stored configuration', () => {
  it('drops a tool the app does not have', () => {
    // `populateToolbarTree`: `if( toolIter == m_availableTools.end() ) continue;`
    expect(
      entriesFromConfig(
        [
          { type: 'TOOL', name: 'toggleGrid' },
          { type: 'TOOL', name: 'notAnAction' },
        ],
        DS_DEFAULT_TOOLBARS,
      ),
    ).toEqual([DS_LEFT_TOOLBAR[0]]);
  });

  it('drops a control the app does not have', () => {
    expect(
      entriesFromConfig([{ type: 'CONTROL', name: 'notAControl' }], DS_DEFAULT_TOOLBARS),
    ).toEqual([]);
  });

  it('drops a group left with no visible items', () => {
    // `if( !haveVisibleGroupItems ) m_toolbarTree->Delete( groupId );`
    expect(
      entriesFromConfig(
        [{ type: 'TB_GROUP', group_name: 'Empty', group_items: [{ type: 'TOOL', name: 'nope' }] }],
        DS_DEFAULT_TOOLBARS,
      ),
    ).toEqual([]);
  });

  it('strips the option-button flag from a button moved into a group', () => {
    // `toggle` is a top-level option button's lit state; inside a group the
    // check-item question is `groupIsCheckItem` over the actions (`AddGroup`'s
    // `isToggleEntry`), and `toolbar_types.ts` forbids the flag on a member.
    // `toggleGrid` carries `toggle: true` on DS_LEFT_TOOLBAR.
    expect(DS_LEFT_TOOLBAR[0]).toMatchObject({ id: 'toggleGrid', toggle: true });
    const [group] = entriesFromConfig(
      [
        {
          type: 'TB_GROUP',
          group_name: 'Mixed',
          group_items: [{ type: 'TOOL', name: 'toggleGrid' }],
        },
      ],
      DS_DEFAULT_TOOLBARS,
    );
    expect(group).toEqual({
      group: 'Mixed',
      actions: [{ id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid' }],
    });
  });

  it('keeps a known group’s cycle-on-click kind', () => {
    const [group] = entriesFromConfig(
      [
        {
          type: 'TB_GROUP',
          group_name: 'Units',
          group_items: [{ type: 'TOOL', name: 'unitsMm' }],
        },
      ],
      DS_DEFAULT_TOOLBARS,
    );
    expect(group).toMatchObject({ group: 'Units', cycleOnClick: true });
  });

  it('offers every button on the app’s own toolbars and none from another app', () => {
    // `m_availableTools` filtered by `isActionSupported`: pl_editor's page
    // offers `plEditor.*` and `common.*` and never `eeschema.*`
    // (`panel_toolbar_customization.cpp:206-241`).
    const ds = toolbarTemplates(DS_DEFAULT_TOOLBARS);
    expect(ds.has('toggleGrid')).toBe(true);
    expect(ds.has('dsAddLine')).toBe(true);
    // On the schematic's toolbars and on none of pl_editor's.
    expect(toolbarTemplates(SCH_DEFAULT_TOOLBARS).has('placeSymbol')).toBe(true);
    expect(ds.has('placeSymbol')).toBe(false);
  });

  it('collects the app’s AppendControl slots', () => {
    expect([...toolbarControlNames(PCB_DEFAULT_TOOLBARS)].sort()).toContain('layerSelector');
    expect(toolbarControlNames(DS_DEFAULT_TOOLBARS).size).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------- GetToolbarConfig

describe('GetToolbarConfig picks between stored and default', () => {
  const custom: ToolbarSettings = { toolbars: [] };
  setStoredToolbarConfig(custom, 'LEFT', [{ type: 'TOOL', name: 'unitsMm' }]);

  it('returns the default list by reference when nothing is customised', () => {
    // Identity, not equality: the common case must not rebuild the array on
    // every render, and `<Toolbar>` sees the same object it always did.
    expect(resolveToolbarConfig(DS_DEFAULT_TOOLBARS, 'LEFT', undefined, false)).toBe(
      DS_LEFT_TOOLBAR,
    );
    expect(resolveToolbarConfig(DS_DEFAULT_TOOLBARS, 'LEFT', custom, false)).toBe(DS_LEFT_TOOLBAR);
  });

  it('returns the stored one when custom_toolbars is on', () => {
    // `if( aAllowCustom ) { auto tb = m_toolbars.find( aToolbar ); … }`
    expect(resolveToolbarConfig(DS_DEFAULT_TOOLBARS, 'LEFT', custom, true)).toEqual([
      { id: 'unitsMm', icon: 'unitsMm', title: 'Units in millimetres' },
    ]);
  });

  it('falls back to the default for a location that is not stored', () => {
    expect(resolveToolbarConfig(DS_DEFAULT_TOOLBARS, 'RIGHT', custom, true)).toBe(DS_RIGHT_TOOLBAR);
  });

  it('gives a location the app does not have an empty toolbar, not the default of another', () => {
    // Upstream returns `std::nullopt` and `RecreateToolbars` then creates no
    // toolbar at all (`eda_base_frame.cpp:1836-1841`).
    expect(resolveToolbarConfig(DS_DEFAULT_TOOLBARS, 'TOP_AUX', custom, true)).toEqual([]);
  });
});
