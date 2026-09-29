// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT_VIEWER_FRAME (pcbnew/footprint_viewer_frame.cpp): the two list
 * filters, the selection a rebuilt list lands on, Previous / Next, the
 * title, LoadSettings' width clamp, the KIWAY player half, AddFootprintToPCB,
 * and the two toolbars and the menu bar against toolbars_footprint_viewer.cpp.
 *
 * Every expectation below is written out from the C++, never computed by the
 * code under test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FOOTPRINT_INFO_IMPL } from '@ziroeda/pcbnew/footprint_info_impl.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/types.js';
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import {
  FOOTPRINT_VIEWER_FRAME,
  FPVIEWER_CONSTANTS,
  FPVIEWER_NO_BOARD,
  FPVIEWER_PLACEMENT_IN_PROGRESS,
  clampFootprintViewerListWidths,
  footprintListRows,
  footprintViewerTitle,
  libraryListRows,
  listSelectionAfterRebuild,
  paneWidthOrBest,
  selectNextIndex,
  selectPrevIndex,
  stepFootprintSelection,
  wxIsNumber,
} from '@ziroeda/pcbnew/footprint_viewer_frame.js';
import {
  FPVIEWER_LEFT_TOOLBAR,
  FPVIEWER_TOP_TOOLBAR,
  footprintViewerMenus,
} from '@ziroeda/pcbnew/toolbars_footprint_viewer.js';
import {
  WxListBox,
  listBoxFindString,
  listBoxGetBaseString,
} from '@ziroeda/common/widgets/wx_listbox.js';

const PIN = '☆ ';

/** One index entry: nickname, name, description, keywords, pad count. */
function fp(lib: string, name: string, descr: string, tags: string, pads: number) {
  return new FOOTPRINT_INFO_IMPL(lib, name, descr, tags, 0, pads, pads);
}

describe('ReCreateLibraryList (libraryListRows)', () => {
  const libs = ['Capacitor_SMD', 'Connector_PinHeader_2.54mm', 'Resistor_SMD', 'Package_SO'];
  const none = (): boolean => false;

  it('lists every nickname, in order, under an empty filter', () => {
    expect(libraryListRows(libs, '', none)).toEqual([
      'Capacitor_SMD',
      'Connector_PinHeader_2.54mm',
      'Resistor_SMD',
      'Package_SO',
    ]);
  });

  it('puts pinned libraries first, each wearing the pinning symbol', () => {
    const pinned = (n: string): boolean => n === 'Resistor_SMD';
    expect(libraryListRows(libs, '', pinned)).toEqual([
      `${PIN}Resistor_SMD`,
      'Capacitor_SMD',
      'Connector_PinHeader_2.54mm',
      'Package_SO',
    ]);
  });

  it('keeps a library ANY term matches, case-insensitively', () => {
    // "smd" matches Capacitor_SMD and Resistor_SMD; nothing else.
    expect(libraryListRows(libs, 'smd', none)).toEqual(['Capacitor_SMD', 'Resistor_SMD']);
    expect(libraryListRows(libs, 'package conn', none)).toEqual([
      'Package_SO',
      'Connector_PinHeader_2.54mm',
    ]);
  });

  it('appends a library twice when two terms both match it (no de-dup upstream)', () => {
    expect(libraryListRows(libs, 'cap smd', none)).toEqual([
      'Capacitor_SMD',
      'Capacitor_SMD',
      'Resistor_SMD',
    ]);
  });

  it('lists nothing when no term matches', () => {
    expect(libraryListRows(libs, 'zzz', none)).toEqual([]);
  });
});

describe('ReCreateFootprintList (footprintListRows)', () => {
  const lib = [
    fp('R', 'R_0402_1005Metric', 'Resistor SMD 0402', 'resistor', 2),
    fp('R', 'R_0603_1610Metric', 'Resistor SMD 0603', 'resistor', 2),
    fp('R', 'R_Array_Convex_4x0402', 'Chip Resistor Network', 'resistor array', 8),
  ];

  it('keeps the library order under an empty filter', () => {
    expect(footprintListRows(lib, '')).toEqual([
      'R_0402_1005Metric',
      'R_0603_1610Metric',
      'R_Array_Convex_4x0402',
    ]);
  });

  it('needs EVERY term to match', () => {
    // "0402" matches two names; "array" matches only the network's keyword.
    expect(footprintListRows(lib, '0402')).toEqual(['R_0402_1005Metric', 'R_Array_Convex_4x0402']);
    expect(footprintListRows(lib, '0402 array')).toEqual(['R_Array_Convex_4x0402']);
  });

  it('scores the description and keywords, not only the name', () => {
    expect(footprintListRows(lib, 'network')).toEqual(['R_Array_Convex_4x0402']);
  });

  it('matches a number term against the pad count', () => {
    // "8" is in no name, description or keyword (test data chosen so); the
    // network has 8 pads.
    expect(footprintListRows(lib, '8')).toEqual(['R_Array_Convex_4x0402']);
  });

  it('wxString::IsNumber: an optional sign then digits', () => {
    expect(wxIsNumber('12')).toBe(true);
    expect(wxIsNumber('-3')).toBe(true);
    expect(wxIsNumber('+')).toBe(true);
    expect(wxIsNumber('1a')).toBe(false);
    expect(wxIsNumber('')).toBe(false);
  });
});

describe('WX_LISTBOX (common/widgets/wx_listbox.cpp)', () => {
  const rows = [`${PIN}Pinned_Lib`, 'Other_Lib', 'other_lib'];

  it('GetBaseString strips the pinning symbol', () => {
    expect(listBoxGetBaseString(rows, 0)).toBe('Pinned_Lib');
    expect(listBoxGetBaseString(rows, 1)).toBe('Other_Lib');
  });

  it('FindString finds a pinned row by its plain name, case-sensitively when asked', () => {
    expect(listBoxFindString(rows, 'Pinned_Lib', true)).toBe(0);
    expect(listBoxFindString(rows, 'other_lib', true)).toBe(2);
    expect(listBoxFindString(rows, 'OTHER_LIB', true)).toBe(-1);
    expect(listBoxFindString(rows, 'OTHER_LIB', false)).toBe(1);
  });

  it('is a component', () => {
    expect(typeof WxListBox).toBe('function');
  });
});

describe('the selection a rebuilt list lands on', () => {
  it('re-finds the current name (pinned or not), else the first row, else none', () => {
    expect(listSelectionAfterRebuild(['A', `${PIN}B`, 'C'], 'B')).toBe(1);
    expect(listSelectionAfterRebuild(['A', 'B', 'C'], 'C')).toBe(2);
    expect(listSelectionAfterRebuild(['A', 'B', 'C'], 'gone')).toBe(0);
    expect(listSelectionAfterRebuild(['A', 'B', 'C'], '')).toBe(0);
    expect(listSelectionAfterRebuild([], 'A')).toBe(-1);
  });

  it('FindString( name, true ) is case-sensitive, so a case change starts over at the top', () => {
    expect(listSelectionAfterRebuild(['a', 'b'], 'B')).toBe(0);
  });
});

describe('SelectAndViewFootprint / selectPrev / selectNext', () => {
  const rows = ['F1', 'F2', 'F3'];

  it('steps once and stops at either end', () => {
    expect(stepFootprintSelection(rows, 'F1', FPVIEWER_CONSTANTS.NEXT_PART)).toBe(1);
    expect(stepFootprintSelection(rows, 'F3', FPVIEWER_CONSTANTS.NEXT_PART)).toBe(2);
    expect(stepFootprintSelection(rows, 'F2', FPVIEWER_CONSTANTS.PREVIOUS_PART)).toBe(0);
    expect(stepFootprintSelection(rows, 'F1', FPVIEWER_CONSTANTS.PREVIOUS_PART)).toBe(0);
    expect(stepFootprintSelection(rows, 'F2', FPVIEWER_CONSTANTS.NEW_PART)).toBe(1);
  });

  it('does nothing for a name the list does not hold', () => {
    expect(stepFootprintSelection(rows, 'nope', FPVIEWER_CONSTANTS.NEXT_PART)).toBe(-1);
  });

  it('the arrow keys move one row and stop at the ends', () => {
    expect(selectPrevIndex(1)).toBe(0);
    expect(selectPrevIndex(0)).toBeNull();
    expect(selectNextIndex(1, 3)).toBe(2);
    expect(selectNextIndex(2, 3)).toBeNull();
    // No selection yet: Down goes to row 0, Up stays put.
    expect(selectNextIndex(-1, 3)).toBe(0);
    expect(selectPrevIndex(-1)).toBeNull();
  });
});

describe('UpdateTitle', () => {
  it('is nickname, URI and the frame name, joined by spaced em dashes', () => {
    expect(footprintViewerTitle('R', '/libs/R.pretty')).toBe(
      'R — /libs/R.pretty — Footprint Library Browser',
    );
  });

  it('says so when no library is selected or its URI is unknown', () => {
    expect(footprintViewerTitle('', null)).toBe(
      '[no library selected] — Footprint Library Browser',
    );
    expect(footprintViewerTitle('R', null)).toBe(
      '[no library selected] — Footprint Library Browser',
    );
  });
});

describe('LoadSettings width clamp', () => {
  it('leaves widths alone when they fit in size_x - 80', () => {
    expect(clampFootprintViewerListWidths(200, 300, 1920)).toEqual({ lib: 200, fp: 300 });
    // 200 + 300 = 500 = 580 - 80: not greater, so not clamped.
    expect(clampFootprintViewerListWidths(200, 300, 580)).toEqual({ lib: 200, fp: 300 });
  });

  it('integer division zeroes the library list and gives the rest to the fp list', () => {
    // maxWidth = 400 - 80 = 320; lib = 320 * (200 / 500 == 0) = 0; fp = 320.
    expect(clampFootprintViewerListWidths(200, 300, 400)).toEqual({ lib: 0, fp: 320 });
  });

  it('a width that is not > 0 falls back to the pane BestSize', () => {
    expect(paneWidthOrBest(0, 200)).toBe(200);
    expect(paneWidthOrBest(-80, 300)).toBe(300);
    expect(paneWidthOrBest(250, 200)).toBe(250);
  });
});

// ----- the KIWAY half ---------------------------------------------------------

function makeKiway(raised: FRAME_T[] = []): KIWAY {
  return new KIWAY({
    OnKiCadExit: () => {},
    Player: (t) => {
      raised.push(t);
      return true;
    },
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
}

const FOOTPRINT = { lib: 'R:R_0402' } as unknown as PcbFootprint;

describe('FOOTPRINT_VIEWER_FRAME as a KIWAY player', () => {
  it('is FRAME_FOOTPRINT_VIEWER and answers MAIL_RELOAD_LIB with ReCreateLibraryList', () => {
    let reloads = 0;
    const frame = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {
        reloads += 1;
      },
      getFirstFootprint: () => null,
    });
    expect(frame.IsType(FRAME_T.FRAME_FOOTPRINT_VIEWER)).toBe(true);

    const kiway = makeKiway();
    kiway.SetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_VIEWER, frame);
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_VIEWER, MAIL_T.MAIL_RELOAD_LIB, { value: '' });
    expect(reloads).toBe(1);

    // Other mail is not this frame's.
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_VIEWER, MAIL_T.MAIL_FP_EDIT, { value: 'x' });
    expect(reloads).toBe(1);

    kiway.PlayerDidClose(FRAME_T.FRAME_FOOTPRINT_VIEWER, frame);
    expect(kiway.GetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_VIEWER)).toBeNull();
    kiway.ExpressMail(FRAME_T.FRAME_FOOTPRINT_VIEWER, MAIL_T.MAIL_RELOAD_LIB, { value: '' });
    expect(reloads).toBe(1);
  });

  it('keeps the current nickname and name (the project retained strings)', () => {
    const frame = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      getFirstFootprint: () => null,
    });
    frame.setCurNickname('Resistor_SMD');
    frame.setCurFootprintName('R_0402_1005Metric');
    expect(frame.getCurNickname()).toBe('Resistor_SMD');
    expect(frame.getCurFootprintName()).toBe('R_0402_1005Metric');
  });
});

/** A board editor as `AddFootprintToPCB` sees one. */
class FakePcbFrame extends KIWAY_PLAYER {
  placing = false;
  placed: [string, PcbFootprint][] = [];
  constructor() {
    super(FRAME_T.FRAME_PCB_EDITOR, pcbIUScale, 'mm');
  }
  PlacingFootprint(): boolean {
    return this.placing;
  }
  PlaceFootprintFromLibraryBrowser(aFpid: string, aFootprint: PcbFootprint): void {
    this.placed.push([aFpid, aFootprint]);
  }
}

describe('AddFootprintToPCB', () => {
  const errors: string[] = [];
  SetErrorPresenter((text) => errors.push(text));
  afterEach(() => {
    errors.length = 0;
  });

  const viewer = (shown: boolean) =>
    new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => {},
      getFirstFootprint: () => (shown ? { fpid: 'R:R_0402', footprint: FOOTPRINT } : null),
    });

  it('does nothing when no footprint is on show', () => {
    const raised: FRAME_T[] = [];
    const kiway = makeKiway(raised);
    const pcb = new FakePcbFrame();
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
    const frame = viewer(false);
    frame.SetKiway(kiway);
    expect(frame.AddFootprintToPCB()).toBe(false);
    expect(pcb.placed).toEqual([]);
    expect(errors).toEqual([]);
    expect(raised).toEqual([]);
  });

  it('"No board currently open." without a board editor', () => {
    const frame = viewer(true);
    frame.SetKiway(makeKiway());
    expect(frame.AddFootprintToPCB()).toBe(false);
    expect(errors).toEqual([FPVIEWER_NO_BOARD]);
    expect(FPVIEWER_NO_BOARD).toBe('No board currently open.');
  });

  it('refuses while a previous placement is still riding the cursor', () => {
    const kiway = makeKiway();
    const pcb = new FakePcbFrame();
    pcb.placing = true;
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
    const frame = viewer(true);
    frame.SetKiway(kiway);
    expect(frame.AddFootprintToPCB()).toBe(false);
    expect(pcb.placed).toEqual([]);
    expect(errors).toEqual([FPVIEWER_PLACEMENT_IN_PROGRESS]);
    expect(FPVIEWER_PLACEMENT_IN_PROGRESS).toBe('Previous footprint placement still in progress.');
  });

  it('hands the footprint to the board editor and raises it', () => {
    const raised: FRAME_T[] = [];
    const kiway = makeKiway(raised);
    const pcb = new FakePcbFrame();
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
    const frame = viewer(true);
    frame.SetKiway(kiway);
    expect(frame.AddFootprintToPCB()).toBe(true);
    expect(pcb.placed).toEqual([['R:R_0402', FOOTPRINT]]);
    expect(raised).toEqual([FRAME_T.FRAME_PCB_EDITOR]);
    expect(errors).toEqual([]);
  });
});

// ----- toolbars_footprint_viewer.cpp -------------------------------------------

/** A bar as upstream's config reads: action ids, `|` for a separator, `[control]`, `{group}`. */
function spell(entries: readonly ToolEntry[]): string[] {
  return entries.map((e) => {
    if (e === 'sep') return '|';
    if ('control' in e) return `[${e.control}]`;
    if ('group' in e) return `{${e.group}: ${e.actions.map((a) => a.id).join(' ')}}`;
    if ('id' in e) return e.id;
    return '?';
  });
}

describe('FOOTPRINT_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig', () => {
  it('TOP_MAIN, entry for entry', () => {
    expect(spell(FPVIEWER_TOP_TOOLBAR)).toEqual([
      'previousFootprint',
      'nextFootprint',
      '|',
      'zoomRedraw',
      'zoomInCenter',
      'zoomOutCenter',
      'zoomFitScreen',
      'zoomTool',
      '|',
      'show3DViewer',
      'saveFpToBoard',
      '|',
      '[gridSelect]',
      '|',
      '[zoomSelect]',
      'fpAutoZoom',
    ]);
  });

  it('LEFT, entry for entry (a separator between the two groups; no bounding boxes)', () => {
    expect(spell(FPVIEWER_LEFT_TOOLBAR)).toEqual([
      'selectionTool',
      'measureTool',
      '|',
      'toggleGrid',
      'togglePolarCoords',
      '{Units: unitsMm unitsInches unitsMils}',
      '|',
      '{Crosshair modes: crosshairSmall crosshairFull crosshair45}',
      '|',
      'showPadNumbers',
      'padDisplayMode',
      'textOutlines',
      'graphicsOutlines',
    ]);
  });

  it('the tooltips are FriendlyName + Tooltip from pcb_actions.cpp / actions.cpp', () => {
    const titles = new Map(
      FPVIEWER_TOP_TOOLBAR.flatMap((e) =>
        typeof e === 'object' && 'id' in e ? [[e.id, e.title]] : [],
      ),
    );
    expect(titles.get('previousFootprint')).toBe('Display previous footprint');
    expect(titles.get('nextFootprint')).toBe('Display next footprint');
    expect(titles.get('saveFpToBoard')).toBe(
      'Insert footprint into PCB\nInsert footprint into current board',
    );
    expect(titles.get('fpAutoZoom')).toBe('Automatic zoom\nAutomatic Zoom on footprint change');
  });
});

describe('FOOTPRINT_VIEWER_FRAME::doReCreateMenuBar', () => {
  const ran: string[] = [];
  let closed = 0;
  const menus = footprintViewerMenus({
    close: () => {
      closed += 1;
    },
    action: (id) => ran.push(id),
    showHotkeys: () => {},
    showAbout: () => {},
  });

  it('File, View, Help', () => {
    expect(menus.map((m) => m.label)).toEqual(['File', 'View', 'Help']);
  });

  it('File holds Close and nothing else', () => {
    const file = menus[0]!.items;
    expect(file.map((i) => i.label)).toEqual(['Close']);
    file[0]!.action!();
    expect(closed).toBe(1);
  });

  it('View opens with a separator, then the four zooms, a separator and the 3D viewer', () => {
    const view = menus[1]!.items;
    expect(
      view.map((i) => (i.sep ? '|' : `${i.label}${i.shortcut ? ` (${i.shortcut})` : ''}`)),
    ).toEqual([
      '|',
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit (Home)',
      'Refresh (F5)',
      '|',
      '3D Viewer (Alt+3)',
    ]);
    for (const item of view) item.action?.();
    expect(ran).toEqual([
      'zoomInCenter',
      'zoomOutCenter',
      'zoomFitScreen',
      'zoomRedraw',
      'show3DViewer',
    ]);
  });
});
