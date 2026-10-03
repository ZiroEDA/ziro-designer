// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BOARD_INSPECTION_TOOL (pcbnew/tools/board_inspection_tool.cpp), the
 * highlight and ratsnest half, driven through the tool manager on a live
 * BOARD with the PCB_PAINTER's render settings. KiCad's qa has no suite for
 * the tool; each expectation is read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { DIALOG_BOOK_REPORTER } from '@ziroeda/common/dialogs/dialog_book_reporter.js';
import { DRC_ITEM, PCB_DRC_CODE } from '@ziroeda/pcbnew/drc/drc_item.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { BUT_LEFT, TA_MOUSE_CLICK, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { FormatProbeItem } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCB_RENDER_SETTINGS } from '@ziroeda/pcbnew/pcb_painter.js';
import {
  BOARD_INSPECTION_TOOL,
  type BOARD_INSPECTION_TOOL_FRAME,
} from '@ziroeda/pcbnew/tools/board_inspection_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_PICKER_TOOL } from '@ziroeda/pcbnew/tools/pcb_picker_tool.js';
import {
  byUuid,
  mm,
  mouse,
  select,
  type TOOL_HARNESS,
  toolHarness,
  U,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (25 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 3 0) (layer "F.SilkS") (uuid "${U(3)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "${U(5)}"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (net 2 "N2") (uuid "${U(6)}"))
  )
  (footprint "C" (layer "F.Cu") (uuid "${U(7)}") (at 90 30)
    (property "Reference" "C1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(8)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "${U(9)}"))
  )
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 10 20) (end 20 20) (width 0.25) (layer "F.Cu") (net 2) (uuid "${U(21)}"))
  (via (at 170 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(40)}"))
  (via (at 172 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 2) (uuid "${U(41)}"))
  (segment (start 10 90) (end 20 90) (width 0.25) (layer "B.Cu") (net 1) (uuid "${U(22)}"))
  (segment (start 10 92) (end 20 92) (width 0.25) (layer "B.Cu") (net 2) (uuid "${U(23)}"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(30)}"))
  (gr_line (start 10 60) (end 20 60) (stroke (width 0.1) (type solid)) (layer "F.Cu") (uuid "${U(31)}"))
)
`;

class INSPECTION_FRAME extends TEST_PCB_FRAME implements BOARD_INSPECTION_TOOL_FRAME {
  inspectDrcErrorDlg = new DIALOG_BOOK_REPORTER('InspectDrcErrorDialog', 'Violation Report');
  inspectClearanceDlg = new DIALOG_BOOK_REPORTER('InspectClearanceDialog', 'Clearance Report');
  inspectConstraintsDlg = new DIALOG_BOOK_REPORTER(
    'InspectConstraintsDialog',
    'Constraints Report',
  );
  infoBarErrors: string[] = [];
  associations: string[] = [];
  GetInspectClearanceDialog(): DIALOG_BOOK_REPORTER {
    return this.inspectClearanceDlg;
  }
  GetInspectConstraintsDialog(): DIALOG_BOOK_REPORTER {
    return this.inspectConstraintsDlg;
  }
  ShowInfoBarError(aErrorMsg: string): void {
    this.infoBarErrors.push(aErrorMsg);
  }
  ShowFootprintAssociationsDialog(aFootprint: FOOTPRINT): void {
    this.associations.push(aFootprint.GetReference());
  }
  GetInspectDrcErrorDialog(): DIALOG_BOOK_REPORTER {
    return this.inspectDrcErrorDlg;
  }
  GetDesignRulesPath(): string {
    return '';
  }
  GetDesignRulesText(): string | null {
    return null;
  }
  probedDuringSelect: boolean[] = [];
  sentNets: string[] = [];
  sentItems: string[] = [];
  statistics = 0;
  ShowBoardStatisticsDialog(): void {
    this.statistics++;
  }
  SendCrossProbeItem(aItem: BOARD_ITEM | null): void {
    this.sentItems.push(FormatProbeItem(aItem));
  }
  SendCrossProbeNetName(aNetName: string): void {
    this.sentNets.push(aNetName);
  }
}

type Harness = TOOL_HARNESS<INSPECTION_FRAME>;

let h: Harness;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new INSPECTION_FRAME(aBoard),
    () => [new PCB_PICKER_TOOL(), new BOARD_INSPECTION_TOOL()],
  );
});

const rs = (): PCB_RENDER_SETTINGS => h.view.GetPainter()!.GetSettings() as PCB_RENDER_SETTINGS;
const lit = (): number[] =>
  rs().IsHighlightEnabled() ? [...rs().GetHighlightNetCodes()].sort() : [];
const boardLit = (): number[] =>
  h.board.IsHighLightNetON() ? [...h.board.GetHighLightNetCodes()].sort() : [];

describe('BOARD_INSPECTION_TOOL::highlightNet at the cursor (board_inspection_tool.cpp:2085-2227)', () => {
  it('highlights the net of the copper item under the cursor, on the board and the view', () => {
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet);
    expect(lit()).toEqual([1]);
    expect(boardLit()).toEqual([1]);
    // SendCrossProbeNetName( netinfo->GetNetname() ) (:2205)
    expect(h.frame.sentNets).toEqual(['N1']);
    // the net's message panel (:2202-2204)
    expect(h.frame.GetMsgPanelItems().map((i) => i.GetUpperText())[0]).toBe('Net Name');
  });

  it('picking the same net again toggles it off (:2179-2181)', () => {
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet);
    expect(lit()).toEqual([]);
    expect(boardLit()).toEqual([]);
    expect(h.frame.sentNets).toEqual(['N1', '']);
  });

  it('a pad under the cursor is cross-probed as its part and pad (:2172-2173)', () => {
    h.mouse = mm(59, 30);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet);
    expect(h.frame.sentItems).toEqual(['$PART: "R1" $PAD: "1"']);
    expect(lit()).toEqual([1]);
  });

  it('a graphic off copper is no net to highlight (:2153-2162)', () => {
    h.mouse = mm(15, 50);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet);
    expect(lit()).toEqual([]);
  });

  it('with a net code as the parameter, that net (:2236-2243)', () => {
    h.mgr.RunAction(PCB_ACTIONS.highlightNet, 2);
    expect(lit()).toEqual([2]);
  });
});

describe('highlightNetSelection and the toggles (:2230-2269)', () => {
  it("the selection's nets, several at once (:2100-2118)", () => {
    select(h, 20, 21);
    h.mgr.RunAction(PCB_ACTIONS.highlightNetSelection);
    expect(lit()).toEqual([1, 2]);
    expect(boardLit()).toEqual([1, 2]);
  });

  it('one selected net goes the single path, cross-probing it (:2119-2122)', () => {
    select(h, 21);
    h.mgr.RunAction(PCB_ACTIONS.highlightNetSelection);
    expect(lit()).toEqual([2]);
    expect(h.frame.sentNets).toEqual(['N2']);
  });

  it('toggleNetHighlight hides the highlight and brings it back (:2256-2261)', () => {
    h.mgr.RunAction(PCB_ACTIONS.highlightNet, 1);
    h.mgr.RunAction(PCB_ACTIONS.toggleNetHighlight);
    expect(lit()).toEqual([]);
    h.mgr.RunAction(PCB_ACTIONS.toggleNetHighlight);
    expect(lit()).toEqual([1]);
  });

  it('toggleLastNetHighlight swaps to the previous highlight (:2248-2255)', () => {
    h.mgr.RunAction(PCB_ACTIONS.highlightNet, 1);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet, 2);
    h.mgr.RunAction(PCB_ACTIONS.toggleLastNetHighlight);
    expect(lit()).toEqual([1]);
    h.mgr.RunAction(PCB_ACTIONS.toggleLastNetHighlight);
    expect(lit()).toEqual([2]);
  });

  it('clearHighlight clears the view, the board and the cross-probe (:2272-2286)', () => {
    h.mgr.RunAction(PCB_ACTIONS.highlightNet, 1);
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.highlightNet);
    h.mgr.RunAction(PCB_ACTIONS.clearHighlight);
    expect(lit()).toEqual([]);
    expect(boardLit()).toEqual([]);
    expect(h.frame.sentNets.at(-1)).toBe('');
    // m_lastHighlighted is cleared too: the last-highlight toggle has nothing to restore
    h.mgr.RunAction(PCB_ACTIONS.toggleLastNetHighlight);
    expect(lit()).toEqual([]);
  });

  it('Esc in the selection tool with nothing selected clears it (pcb_selection_tool.cpp:571-577)', () => {
    h.mgr.RunAction(PCB_ACTIONS.highlightNet, 1);
    const tool = h.mgr.FindTool('pcbnew.InspectionTool') as BOARD_INSPECTION_TOOL;
    expect(tool.IsNetHighlightSet()).toBe(true);
    tool.ClearHighlight(null as never);
    expect(tool.IsNetHighlightSet()).toBe(false);
  });
});

describe('the ratsnest (:2289-2529)', () => {
  it("hide/showNetInRatsnest with no net take the selection's nets (:2495-2511)", () => {
    select(h, 20, 21);
    h.mgr.RunAction(PCB_ACTIONS.hideNetInRatsnest);
    expect([...rs().GetHiddenNets()].sort()).toEqual([1, 2]);
    h.mgr.RunAction(PCB_ACTIONS.showNetInRatsnest);
    expect([...rs().GetHiddenNets()]).toEqual([]);
  });

  it('with a net code, that net alone', () => {
    h.mgr.RunAction(PCB_ACTIONS.hideNetInRatsnest, 2);
    expect([...rs().GetHiddenNets()]).toEqual([2]);
  });

  it("updateLocalRatsnest draws a moving footprint's airwires; hideLocalRatsnest clears them", () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
    const lines = h.board.GetConnectivity().GetLocalRatsnest();
    expect(lines.length).toBeGreaterThan(0);
    h.mgr.RunAction(PCB_ACTIONS.hideLocalRatsnest);
    expect(h.board.GetConnectivity().GetLocalRatsnest()).toHaveLength(0);
  });

  it('with nothing selected, updateLocalRatsnest clears (:2385-2390)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
    h.mgr.RunAction(ACTIONS.selectionClear);
    h.mgr.RunAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
    expect(h.board.GetConnectivity().GetLocalRatsnest()).toHaveLength(0);
  });

  it('the Local Ratsnest tool toggles a clicked pad (:2299-2351, PadFilter first)', () => {
    h.mgr.RunAction(PCB_ACTIONS.localRatsnestTool);
    const pad = byUuid(h.board, 9) as PAD;
    const other = byUuid(h.board, 5) as PAD;
    const before = pad.GetLocalRatsnestVisible();
    mouse(h, TA_MOUSE_CLICK, mm(89, 30), BUT_LEFT);
    expect(pad.GetLocalRatsnestVisible()).toBe(!before);
    expect(other.GetLocalRatsnestVisible()).toBe(before);
    // a click on nothing puts every pad back to the global setting (:2318-2325)
    mouse(h, TA_MOUSE_CLICK, mm(150, 150), BUT_LEFT);
    expect(pad.GetLocalRatsnestVisible()).toBe(
      h.frame.GetPcbNewSettings().m_Display.m_ShowGlobalRatsnest,
    );
  });
});

describe('the rest', () => {
  it('HighlightItem selects the cross-probed item under the recursion guard (:2057-2081)', () => {
    const item = byUuid(h.board, 7);
    h.mgr.RunAction(PCB_ACTIONS.highlightItem, item);
    expect([...h.sel.GetSelection()]).toEqual([item]);
    expect(h.frame.m_ProbingSchToPcb).toBe(false);
  });

  it("boardStatistics opens the frame's dialog (:150-155)", () => {
    h.mgr.RunAction(PCB_ACTIONS.boardStatistics);
    expect(h.frame.statistics).toBe(1);
  });

  it("Init's Net Inspection Tools: only on wholly connectable selections (:96-129)", () => {
    const menu = h.sel.GetToolMenu().GetMenu();
    const shows = (...n: number[]): boolean => {
      const s = new SELECTION();
      for (const i of n) s.Add(byUuid(h.board, i));
      menu.Evaluate(s);
      return menu
        .GetMenuItems()
        .some(
          (m) =>
            m.GetItemLabelText?.() === 'Net Inspection Tools' ||
            (m.GetSubMenu() as { GetTitle?(): string } | null)?.GetTitle?.() ===
              'Net Inspection Tools',
        );
    };
    expect(shows(20, 5)).toBe(true);
    // a copper graphic counts; a silk one does not
    expect(shows(31)).toBe(true);
    expect(shows(30)).toBe(false);
    expect(shows(1)).toBe(false);
  });

  it('NET_CONTEXT_MENU: four rows around one rule, Clear carrying ~ (:68-82)', () => {
    const tool = h.mgr.FindTool('pcbnew.InspectionTool') as BOARD_INSPECTION_TOOL;
    const menu = tool.GetNetSubMenu()!;
    expect(menu.GetTitle()).toBe('Net Inspection Tools');
    const rows = menu.GetMenuItems().map((m) => (m.IsSeparator() ? '-' : m.GetItemLabelText()));
    expect(rows).toEqual([
      'Show Net in Ratsnest',
      'Hide Net in Ratsnest',
      '-',
      'Highlight Net',
      'Clear Net Highlighting',
    ]);
  });

  it('FormatProbeItem (cross-probing.cpp:258-307)', () => {
    expect(FormatProbeItem(null)).toBe('$CLEAR: "HIGHLIGHTED"');
    expect(FormatProbeItem(byUuid(h.board, 1))).toBe('$PART: "R1"');
    expect(FormatProbeItem(byUuid(h.board, 6))).toBe('$PART: "R1" $PAD: "2"');
    expect(FormatProbeItem(byUuid(h.board, 2))).toBe('$PART: "R1" $REF: "R1"');
    expect(FormatProbeItem(byUuid(h.board, 3))).toBe('$PART: "R1" $VAL: "10k"');
    expect(FormatProbeItem(byUuid(h.board, 20))).toBe('');
  });
});

const violation = (aCode: PCB_DRC_CODE, a: number, b?: number): DRC_ITEM => {
  const item = DRC_ITEM.Create(aCode)!;
  item.SetItems(byUuid(h.board, a), b === undefined ? null : byUuid(h.board, b));
  return item;
};

const tool = (): BOARD_INSPECTION_TOOL =>
  h.mgr.FindTool('pcbnew.InspectionTool') as unknown as BOARD_INSPECTION_TOOL;

const pages = (): { title: string; messages: readonly string[] }[] =>
  h.frame.inspectDrcErrorDlg.GetPages();

describe('BOARD_INSPECTION_TOOL::InspectDRCErrorMenuText (board_inspection_tool.cpp:498-530)', () => {
  it('a clearance-family violation offers Clearance Resolution', () => {
    // No menu bar in the test frame: GetRunMenuCommandDescription's fallback,
    // "Run: " + the action's friendly name (pcb_actions.cpp:2203).
    for (const code of [
      PCB_DRC_CODE.DRCE_CLEARANCE,
      PCB_DRC_CODE.DRCE_EDGE_CLEARANCE,
      PCB_DRC_CODE.DRCE_HOLE_CLEARANCE,
      PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE,
      PCB_DRC_CODE.DRCE_STARVED_THERMAL,
    ])
      expect(tool().InspectDRCErrorMenuText(violation(code, 20))).toBe('Run: Clearance Resolution');
  });

  it('a constraint-family violation offers Constraints Resolution', () => {
    for (const code of [
      PCB_DRC_CODE.DRCE_TEXT_HEIGHT,
      PCB_DRC_CODE.DRCE_TRACK_WIDTH,
      PCB_DRC_CODE.DRCE_VIA_DIAMETER,
      PCB_DRC_CODE.DRCE_CONNECTION_WIDTH,
      PCB_DRC_CODE.DRCE_ASSERTION_FAILURE,
    ])
      expect(tool().InspectDRCErrorMenuText(violation(code, 20))).toBe(
        'Run: Constraints Resolution',
      );
  });

  it('anything else offers no row (and the footprint mismatch waits for DiffFootprint)', () => {
    expect(tool().InspectDRCErrorMenuText(violation(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, 20))).toBe(
      '',
    );
    expect(
      tool().InspectDRCErrorMenuText(violation(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, 1)),
    ).toBe('');
  });
});

describe('BOARD_INSPECTION_TOOL::InspectDRCError (board_inspection_tool.cpp:532-892)', () => {
  it('a clearance violation between two nets: one Clearance page, on the track layer, shown', () => {
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_CLEARANCE, 20, 21));
    const [page, ...more] = pages();
    expect(more).toEqual([]);
    expect(page?.title).toBe('Clearance');
    const text = page!.messages.join('\n');
    // reportHeader( title, a, b, layer, r ): the layer line first (:440-449);
    // a track's layer is the report's layer (:782-784).
    expect(page!.messages[0]).toBe('<h7>Clearance resolution for:</h7>');
    expect(page!.messages[1]).toMatch(/^<ul><li>Layer F\.Cu<\/li><li>.*<\/li><li>.*<\/li><\/ul>$/);
    expect(text).toMatch(/Resolved min clearance: 0\.2\d* mm\./);
    // The physical half. 10.0.6 always has one physical_clearance rule, the
    // implicit "barcode visual separation default" (drc_engine.cpp:257-262,
    // condition A.Type == 'Barcode'), so HasRulesForConstraintType is true even
    // with no custom rules: the rule is tried, ignored, and the result is 0.
    expect(text).toContain('<h7>Physical clearance resolution for:</h7>');
    expect(text).toContain('Membership not satisfied; constraint ignored.');
    expect(text).not.toContain("No 'physical_clearance' constraints defined.");
    expect(page!.messages.at(-1)).toBe('Resolved min clearance: 0 mm.');
    expect(h.frame.inspectDrcErrorDlg.IsShown()).toBe(true);
  });

  it("reports on the track's own layer, not the active one (:782-784)", () => {
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_CLEARANCE, 22, 23));
    expect(pages()[0]!.messages[1]).toMatch(/^<ul><li>Layer B\.Cu<\/li>/);
    // getItemDescription adds the effective netclass to a connected item (:212-217).
    expect(pages()[0]!.messages[1]).toMatch(
      /<li>Track \[N1\][^<]* \[netclass Default\]<\/li><li>Track \[N2\][^<]* \[netclass Default\]<\/li>/,
    );
  });

  it('two items on one net: clearance is 0, and the physical half still runs (:839-843)', () => {
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_CLEARANCE, 20, 5));
    const messages = pages()[0]!.messages;
    const physical = messages.indexOf('<h7>Physical clearance resolution for:</h7>');
    // The electrical half is the same-net line and nothing resolved...
    expect(messages.slice(0, physical)).toContain('Items belong to the same net. Clearance is 0.');
    expect(messages.slice(0, physical).some((m) => m.startsWith('Resolved'))).toBe(false);
    // ...and the physical half runs regardless.
    expect(physical).toBeGreaterThan(0);
    expect(messages.at(-1)).toBe('Resolved min clearance: 0 mm.');
  });

  it('a one-item constraint: the one-item header and min/max, an absent bound in italics', () => {
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_TRACK_WIDTH, 20));
    const page = pages()[0]!;
    expect(page.title).toBe('Track Width');
    expect(page.messages[0]).toBe('<h7>Track width resolution for:</h7>');
    expect(page.messages[1]).toMatch(/^<ul><li>[^<]*<\/li><\/ul>$/);
    expect(page.messages.at(-1)).toMatch(
      /^Resolved width constraints: min .+; max <i>undefined<\/i>\.$/,
    );
  });

  it('re-inspecting replaces the pages (DeleteAllPages, :555)', () => {
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_TRACK_WIDTH, 20));
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_CLEARANCE, 20, 21));
    expect(pages().map((p) => p.title)).toEqual(['Clearance']);
  });

  it('a violation it has no report for adds no page and shows nothing (default: return)', () => {
    tool().InspectDRCError(violation(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, 20, 21));
    expect(pages()).toEqual([]);
    expect(h.frame.inspectDrcErrorDlg.IsShown()).toBe(false);
  });
});

/** A report page as its messages, the HTML tags dropped. */
const text = (aMessages: readonly string[]): string[] =>
  aMessages.map((m) => m.replace(/<[^>]+>/g, ''));

describe('BOARD_INSPECTION_TOOL::InspectClearance (board_inspection_tool.cpp:895-1636)', () => {
  it('two tracks on two nets: one page per shared copper layer, the netclass clearance', () => {
    select(h, 20, 21);
    h.mgr.RunAction(PCB_ACTIONS.inspectClearance);
    const dlg = h.frame.inspectClearanceDlg;
    expect(dlg.IsShown()).toBe(true);
    const pages = dlg.GetPages();
    expect(pages.map((p) => p.title)).toEqual(['F.Cu', 'Physical Clearances']);
    const first = text(pages[0]!.messages);
    expect(first[0]).toBe('Clearance resolution for:');
    // The Default netclass's clearance, DEFAULT_CLEARANCE = 0.2 mm (netclass.cpp),
    // in StringFromValue's form: trailing zeros stripped.
    expect(first.at(-1)).toBe('Resolved min clearance: 0.2 mm.');
    // DRC_ENGINE's implicit "barcode visual separation default" is a
    // physical_clearance rule (drc_engine.cpp:257-262), so the per-layer
    // branch runs, and its condition keeps it off two tracks.
    expect(text(pages[1]!.messages)).toContain(
      "No 'physical_clearance' constraints in effect on F.Cu.",
    );
  });

  it('a pad and a track of one net clear by nothing', () => {
    select(h, 5, 20);
    h.mgr.RunAction(PCB_ACTIONS.inspectClearance);
    const first = text(h.frame.inspectClearanceDlg.GetPages()[0]!.messages);
    expect(first.at(-1)).toBe('Items belong to the same net. Min clearance is 0.');
  });

  it('two vias share two layers: a Clearance page whose choice picks the layer (:1240-1302)', () => {
    select(h, 40, 41);
    h.mgr.RunAction(PCB_ACTIONS.inspectClearance);
    const page = h.frame.inspectClearanceDlg.GetPages()[0]!;
    expect(page.title).toBe('Clearance');
    const [label, choice, report] = page.panel!;
    expect(label).toEqual({ kind: 'text', text: 'Layer:' });
    if (choice?.kind !== 'choice' || report?.kind !== 'report') throw new Error('panel');
    // The active layer first, then the rest of the intersection in order.
    expect(choice.items).toEqual(['F.Cu', 'B.Cu']);
    expect(choice.selection).toBe(0);
    expect(text(report.messages)[1]).toContain('Layer F.Cu');
    choice.select(1);
    const after = h.frame.inspectClearanceDlg.GetPages()[0]!.panel![2]!;
    if (after.kind !== 'report') throw new Error('panel');
    expect(text(after.messages)[1]).toContain('Layer B.Cu');
  });

  it('with nothing selected, picks two items with the picker', () => {
    h.mgr.RunAction(PCB_ACTIONS.inspectClearance);
    mouse(h, TA_MOUSE_CLICK, mm(15, 10), BUT_LEFT);
    expect(h.frame.inspectClearanceDlg.IsShown()).toBe(false);
    // The tool learns of the first pick on the next event, as upstream: the
    // motion towards the second item.
    mouse(h, TA_MOUSE_MOTION, mm(15, 20));
    mouse(h, TA_MOUSE_CLICK, mm(15, 20), BUT_LEFT);
    mouse(h, TA_MOUSE_MOTION, mm(15, 20));
    expect(h.frame.inspectClearanceDlg.IsShown()).toBe(true);
    expect(h.frame.inspectClearanceDlg.GetPages()[0]!.title).toBe('F.Cu');
  });

  it('refuses the same item picked twice', () => {
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.inspectClearance);
    mouse(h, TA_MOUSE_CLICK, mm(15, 10), BUT_LEFT);
    mouse(h, TA_MOUSE_MOTION, mm(15, 10));
    expect(h.frame.infoBarErrors).toEqual(['Select two different items for clearance resolution.']);
    expect(h.frame.inspectClearanceDlg.IsShown()).toBe(false);
  });
});

describe('BOARD_INSPECTION_TOOL::InspectConstraints (board_inspection_tool.cpp:1639-1904)', () => {
  it('a track: width, mask, keepouts, assertions', () => {
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.inspectConstraints);
    const pages = h.frame.inspectConstraintsDlg.GetPages();
    expect(pages.map((p) => p.title)).toEqual([
      'Track Width',
      'Solder Mask',
      'Keepouts',
      'Assertions',
    ]);
    expect(text(pages[2]!.messages).at(-1)).toBe('Item allowed at current location.');
  });

  it('a via: diameter, annular width, hole, mask, keepouts, assertions', () => {
    select(h, 40);
    h.mgr.RunAction(PCB_ACTIONS.inspectConstraints);
    expect(h.frame.inspectConstraintsDlg.GetPages().map((p) => p.title)).toEqual([
      'Via Diameter',
      'Via Annular Width',
      'Hole Size',
      'Solder Mask',
      'Keepouts',
      'Assertions',
    ]);
  });

  it('refuses a selection of two', () => {
    select(h, 20, 21);
    h.mgr.RunAction(PCB_ACTIONS.inspectConstraints);
    expect(h.frame.infoBarErrors).toEqual([
      'Select a single item for a constraints resolution report.',
    ]);
    expect(h.frame.inspectConstraintsDlg.GetPageCount()).toBe(0);
  });
});

describe('BOARD_INSPECTION_TOOL::ShowFootprintLinks (board_inspection_tool.cpp:1937-1958)', () => {
  it('opens on the one selected footprint, and refuses anything else', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.showFootprintAssociations);
    expect(h.frame.associations).toEqual(['R1']);
    h.sel.ClearSelection(true);
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.showFootprintAssociations);
    expect(h.frame.infoBarErrors).toEqual([
      'Select a footprint for a footprint associations report.',
    ]);
  });
});
