// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_GROUP_TOOL (pcbnew/tools/pcb_group_tool.cpp) and the GROUP_TOOL base it
 * inherits (common/tool/group_tool.cpp), driven through the tool manager on a
 * live BOARD with a real BOARD_COMMIT. KiCad's qa has no suite for the tool;
 * each expectation is read off the C++ line it cites.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  type DIALOG_GROUP_PROPERTIES,
  SetGroupPropertiesDialogFactory,
} from '@ziroeda/common/tool/group_tool.js';
import { BUT_LEFT, TA_MOUSE_CLICK } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { PCB_GROUP } from '@ziroeda/pcbnew/pcb_group.js';
import { PCB_GROUP_TOOL } from '@ziroeda/pcbnew/tools/pcb_group_tool.js';
import { PCB_PICKER_TOOL } from '@ziroeda/pcbnew/tools/pcb_picker_tool.js';
import {
  byUuid,
  ids,
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
    (35 "F.Fab" user)
    (25 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 3 0) (layer "F.Fab") (hide yes) (uuid "${U(3)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "${U(5)}"))
  )
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 20 10) (end 20 20) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(21)}"))
  (segment (start 100 100) (end 110 100) (width 0.25) (layer "F.Cu") (locked yes) (net 1) (uuid "${U(22)}"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(30)}"))
  (gr_line (start 30 40) (end 30 45) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(31)}"))
  (group "pair" (uuid "${U(50)}") (members "${U(30)}" "${U(31)}"))
  (table (column_count 1) (uuid "${U(60)}") (layer "F.SilkS")
    (border (external yes) (header no) (stroke (width 0.05) (type solid)))
    (separators (rows no) (cols no))
    (column_widths 10) (row_heights 5)
    (cells
      (table_cell "c" (start 90 90) (end 100 95) (margins 1 1 1 1) (span 1 1)
        (layer "F.SilkS") (uuid "${U(61)}") (effects (font (size 1 1))))))
)
`;

class GROUP_FRAME extends TEST_PCB_FRAME {
  warnings: string[] = [];
  modified = 0;
  override ShowInfoBarWarning(aMsg: string): void {
    this.warnings.push(aMsg);
  }
  override OnModify(): void {
    super.OnModify();
    this.modified++;
  }
}

type Harness = TOOL_HARNESS<GROUP_FRAME>;

function harness(): Harness {
  return toolHarness(
    BOARD_TEXT,
    (aBoard) => new GROUP_FRAME(aBoard),
    () => [new PCB_PICKER_TOOL(), new PCB_GROUP_TOOL()],
  );
}

const groups = (h: Harness): PCB_GROUP[] => [...h.board.Groups()];
const selected = (h: Harness): string[] => ids(h.sel.GetSelection());

let h: Harness;

beforeEach(() => {
  h = harness();
});

afterEach(() => {
  SetGroupPropertiesDialogFactory(null);
});

describe('PCB_GROUP_TOOL::Group (pcb_group_tool.cpp:159-221)', () => {
  it('makes one new PCB_GROUP on the board of the selected items, then selects it alone', () => {
    select(h, 20, 21);
    h.mgr.RunAction(ACTIONS.group);

    const made = groups(h).filter((g) => g.m_Uuid !== U(50));
    expect(made).toHaveLength(1);
    const g = made[0]!;
    // `new PCB_GROUP( board )` (:179)
    expect(g.GetParent()).toBe(h.board);
    expect(ids(g.GetItems()).sort()).toEqual([U(20), U(21)]);
    expect(byUuid(h.board, 20).GetParentGroup()).toBe(g);
    // `selectionClear` then `selectItem, group` (:211-212)
    expect(selected(h)).toEqual([g.m_Uuid]);
    // `m_commit->Push( _( "Group Items" ) )` (:209): one undo entry
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.modified).toBeGreaterThan(0);
    expect(g.IsLocked()).toBe(false);
  });

  it('a locked member locks the new group (:181-188)', () => {
    select(h, 20, 22);
    h.mgr.RunAction(ACTIONS.group);
    const g = byUuid(h.board, 22).GetParentGroup() as unknown as PCB_GROUP;
    expect(g).not.toBeNull();
    expect(g.IsLocked()).toBe(true);
  });

  it('fewer than two groupable items: nothing is made, and the refusal is shown (:169-175)', () => {
    // the pad is a footprint child: canGroupItem refuses it (:52-56) and the
    // client filter takes it out, leaving one item
    select(h, 5, 20);
    h.mgr.RunAction(ACTIONS.group);
    expect(groups(h)).toHaveLength(1);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.warnings).toEqual([
      'Footprint items cannot be grouped separately from their parent footprint.',
    ]);
  });

  it('a table cell is not a groupable type (:58-62)', () => {
    select(h, 61, 20);
    h.mgr.RunAction(ACTIONS.group);
    expect(groups(h)).toHaveLength(1);
    expect(h.frame.warnings).toEqual(['Some selected items cannot be grouped.']);
  });

  it('a refused item does not stop the rest being grouped; the warning follows (:217-218)', () => {
    select(h, 5, 20, 21);
    h.mgr.RunAction(ACTIONS.group);
    const g = byUuid(h.board, 20).GetParentGroup() as unknown as PCB_GROUP;
    expect(ids(g.GetItems()).sort()).toEqual([U(20), U(21)]);
    expect(byUuid(h.board, 5).GetParentGroup()).toBeNull();
    expect(h.frame.warnings).toEqual([
      'Footprint items cannot be grouped separately from their parent footprint.',
    ]);
  });

  it('a member of another group moves into the new one, and the old group keeps the rest (:190-202)', () => {
    select(h, 30, 20);
    h.mgr.RunAction(ACTIONS.group);
    const pair = byUuid(h.board, 50) as unknown as PCB_GROUP;
    const g = byUuid(h.board, 30).GetParentGroup() as unknown as PCB_GROUP;
    expect(g).not.toBe(pair);
    expect(ids(pair.GetItems())).toEqual([U(31)]);
    expect(groups(h)).toHaveLength(2);
  });

  it('undo gives the moved member back to its old group (:195-196 Modify the old group)', () => {
    select(h, 30, 20);
    h.mgr.RunAction(ACTIONS.group);
    h.frame.RollbackFromUndo();
    const pair = byUuid(h.board, 50) as unknown as PCB_GROUP;
    expect(ids(pair.GetItems()).sort()).toEqual([U(30), U(31)]);
    expect(byUuid(h.board, 30).GetParentGroup()).toBe(pair);
  });

  it('the undo entry holds the old group, the moved items and the new group (:190-207)', () => {
    select(h, 30, 20);
    h.mgr.RunAction(ACTIONS.group);
    const g = byUuid(h.board, 20).GetParentGroup() as unknown as PCB_GROUP;
    const entry = h.frame.PopCommandFromUndoList()!;
    const picked: string[] = [];
    for (let i = 0; i < entry.GetCount(); i++) picked.push(entry.GetPickedItem(i)!.m_Uuid);
    expect(picked.sort()).toEqual([U(20), U(30), U(50), g.m_Uuid].sort());
  });

  it('with nothing selected, the item under the cursor is not enough on its own (RequestSelection)', () => {
    h.mouse = mm(15, 10);
    h.mgr.RunAction(ACTIONS.group);
    expect(groups(h)).toHaveLength(1);
  });

  it('is undone as one step: the group is gone and its members are free again', () => {
    select(h, 20, 21);
    h.mgr.RunAction(ACTIONS.group);
    h.frame.RollbackFromUndo();
    expect(groups(h)).toHaveLength(1);
    expect(byUuid(h.board, 20).GetParentGroup()).toBeNull();
    expect(byUuid(h.board, 21).GetParentGroup()).toBeNull();
  });
});

describe('GROUP_TOOL on the board (group_tool.cpp:161-292)', () => {
  it('Ungroup removes the group and selects its members (:161-197)', () => {
    select(h, 50);
    h.mgr.RunAction(ACTIONS.ungroup);
    expect(groups(h)).toHaveLength(0);
    expect(byUuid(h.board, 30).GetParentGroup()).toBeNull();
    expect(selected(h).sort()).toEqual([U(30), U(31)]);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('Add to Group takes an item from another group too (:200-252)', () => {
    select(h, 20, 21);
    h.mgr.RunAction(ACTIONS.group);
    const g = byUuid(h.board, 20).GetParentGroup() as unknown as PCB_GROUP;
    h.mgr.RunAction(ACTIONS.selectionClear);
    // `else if( canGroupItem( item, errorMsg ) )` (:215): no "not already in a
    // group" test, so 30 leaves `pair` for g
    h.sel.AddItemToSel(g, true);
    select(h, 30);
    h.mgr.RunAction(ACTIONS.addToGroup);
    expect(byUuid(h.board, 30).GetParentGroup()).toBe(g);
    expect(ids((byUuid(h.board, 50) as unknown as PCB_GROUP).GetItems())).toEqual([U(31)]);
    // `m_selectionTool->AddItemToSel( group )` (:247)
    expect(selected(h)).toEqual([g.m_Uuid]);
  });

  it('Remove from Group dissolves a group left with one member (:255-292)', () => {
    select(h, 30);
    h.mgr.RunAction(ACTIONS.removeFromGroup);
    expect(groups(h)).toHaveLength(0);
    expect(byUuid(h.board, 31).GetParentGroup()).toBeNull();
  });
});

describe('PCB_GROUP_TOOL::PickNewMember (pcb_group_tool.cpp:69-156)', () => {
  function openDialog(): { added: EDA_ITEM[]; shown: boolean[] } {
    const log = { added: [] as EDA_ITEM[], shown: [] as boolean[] };
    SetGroupPropertiesDialogFactory(
      (): DIALOG_GROUP_PROPERTIES => ({
        Show: (aShow: boolean) => log.shown.push(aShow),
        Destroy: () => {},
        DoAddMember: (aItem: EDA_ITEM) => log.added.push(aItem),
      }),
    );
    h.mgr.RunAction(ACTIONS.groupProperties, byUuid(h.board, 50));
    return log;
  }

  it('hides the dialog, and a click on a footprint field hands the dialog the footprint (:79-117)', () => {
    const log = openDialog();
    h.mgr.RunAction(ACTIONS.pickNewGroupMember);
    // `m_propertiesDialog->Show( false )` (:80)
    expect(log.shown).toEqual([true, false]);

    mouse(h, TA_MOUSE_CLICK, mm(60, 27), BUT_LEFT);
    // the pick is R1's Reference field
    expect([...h.sel.GetSelection()].map((i) => i.GetClass())).toEqual(['PCB_FIELD']);
    // `while( elem->GetParent()->Type() != PCB_T )` walks it up to R1 (:107-111)
    expect(log.added.map((i) => i.Type())).toEqual([KICAD_T.PCB_FOOTPRINT_T]);
    expect((log.added[0] as BOARD_ITEM).m_Uuid).toBe(U(1));
    expect(log.shown).toEqual([true, false, true]);
  });

  it('a click on nothing keeps looking (:100-101)', () => {
    const log = openDialog();
    h.mgr.RunAction(ACTIONS.pickNewGroupMember);
    mouse(h, TA_MOUSE_CLICK, mm(150, 150), BUT_LEFT);
    expect(log.added).toEqual([]);
    mouse(h, TA_MOUSE_CLICK, mm(15, 10), BUT_LEFT);
    expect((log.added[0] as BOARD_ITEM).m_Uuid).toBe(U(20));
  });

  it('one pick ends it: a second click adds nothing more (:116 return false)', () => {
    const log = openDialog();
    h.mgr.RunAction(ACTIONS.pickNewGroupMember);
    mouse(h, TA_MOUSE_CLICK, mm(15, 10), BUT_LEFT);
    mouse(h, TA_MOUSE_CLICK, mm(15, 50), BUT_LEFT);
    expect(log.added.map((i) => (i as BOARD_ITEM).m_Uuid)).toEqual([U(20)]);
  });

  it('a cancel shows the dialog again with nothing added (:128-135)', () => {
    const log = openDialog();
    h.mgr.RunAction(ACTIONS.pickNewGroupMember);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(log.added).toEqual([]);
    expect(log.shown.at(-1)).toBe(true);
  });
});
