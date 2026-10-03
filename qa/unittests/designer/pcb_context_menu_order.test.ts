// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB selection menu is PCB_SELECTION_TOOL's CONDITIONAL_MENU, with the
 * rows every tool's `Init()` adds, evaluated against the selection
 * (TOOL_MENU::ShowContextMenu) - the menu the frame pops up. These pin it on a
 * real PCB_EDIT_FRAME rather than on a hand-written copy in the window, which
 * is what this file used to read.
 *
 * The order of the `@100` band is a consequence, not a design decision: seven
 * tools drop a submenu into it from their own `Init()`, each with `aOrder =
 * 100`, none aware of the others; `CONDITIONAL_MENU::addEntry`
 * (conditional_menu.cpp:210-221) keeps ties in insertion order, and insertion
 * order is the order `PCB_EDIT_FRAME::setupTools` registers the tools
 * (pcb_edit_frame.cpp:949-982):
 *
 *   EDIT_TOOL                separator, [Shape Modification], Position
 *   PCB_EDIT_TABLE_TOOL      five groups of table-cell rows, each opened and
 *                            closed by its own `AddSeparator( 100 )`
 *   BOARD_EDITOR_CONTROL     Locking, [Zones]
 *   BOARD_INSPECTION_TOOL    [Net Inspection Tools]
 *   ALIGN_DISTRIBUTE_TOOL    [Align/Distribute], on MoreThan( 1 )
 *   CONVERT_TOOL             Create from Selection
 *   PCB_GROUP_TOOL           Grouping
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { actionMenuItems } from '@ziroeda/common/tool/action_menu_popup.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "A")
  (footprint "R" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "A")))
  (footprint "R" (layer "F.Cu") (at 20 10)
    (property "Reference" "R2" (at 0 -2 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "A")))
  (footprint "R" (layer "F.Cu") (at 30 10)
    (property "Reference" "R3" (at 0 -2 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "A")))
  (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 1))
)
`;

let frame: PCB_EDIT_FRAME;
let fps: BOARD_ITEM[];
let pad: BOARD_ITEM;
let track: BOARD_ITEM;

beforeAll(() => {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  const board = ParseBoard(BOARD_TEXT);
  frame.SetBoard(board, false);
  fps = board.Footprints();
  pad = board.Footprints()[0]!.Pads()[0]!;
  track = board.Tracks()[0]!;
});

/** The menu the frame pops up over `aItems`. */
const menuOver = (...aItems: BOARD_ITEM[]): MenuItem[] => {
  const sel = frame.GetSelectionTool();
  sel.ClearSelection(true);
  for (const item of aItems) sel.AddItemToSel(item, true);
  const menu = sel.GetToolMenu().GetMenu();
  menu.Evaluate(sel.GetSelection());
  menu.UpdateAll();
  return actionMenuItems(menu);
};

const rowsOf = (aItems: MenuItem[]): string[] => aItems.map((i) => (i.sep ? '----' : i.label!));
const row = (aItems: MenuItem[], aLabel: string): MenuItem | undefined =>
  aItems.find((i) => i.label === aLabel);

/** The `@100` band: from Position to Grouping. */
const band = (aItems: MenuItem[]): string[] => {
  const rows = rowsOf(aItems);
  return rows.slice(rows.indexOf('Position'), rows.indexOf('Grouping') + 1);
};

describe('the PCB selection menu @100 band, in KiCad registration order', () => {
  it('reads Position, Locking, Create from Selection, Grouping over a footprint', () => {
    expect(band(menuOver(fps[0]!)).filter((r) => r !== '----')).toEqual([
      'Position', // EDIT_TOOL, edit_tool.cpp:814
      'Locking', // BOARD_EDITOR_CONTROL, board_editor_control.cpp:437
      'Create from Selection', // CONVERT_TOOL, convert_tool.cpp:333
      'Grouping', // PCB_GROUP_TOOL, group_tool.cpp:138
    ]);
  });

  // PCB_EDIT_TABLE_TOOL's `AddSeparator( 100 )`s (edit_table_tool_base.h:94-115),
  // collapsed to one rule by separator elision: the tool is not ported, so the
  // rule KiCad draws between Position and Locking is not there yet.
  it.fails('keeps a rule between Position and Locking, where the table rows go', () => {
    const rows = band(menuOver(fps[0]!));
    expect(rows[rows.indexOf('Locking') - 1]).toBe('----');
  });

  it('puts Net Inspection Tools after Locking over a pad', () => {
    const rows = band(menuOver(pad));
    expect(rows.indexOf('Net Inspection Tools')).toBeGreaterThan(rows.indexOf('Locking'));
    expect(rows.indexOf('Create from Selection')).toBeGreaterThan(
      rows.indexOf('Net Inspection Tools'),
    );
  });
});

describe('the rows a multi-item selection is entitled to', () => {
  it('offers Pack and Move Footprints, on P, from two footprints', () => {
    expect(row(menuOver(fps[0]!), 'Pack and Move Footprints')).toBeUndefined();
    expect(row(menuOver(fps[0]!, fps[1]!), 'Pack and Move Footprints')?.shortcut).toBe('P');
  });

  it('hides Properties on a multi-selection that is not all tracks', () => {
    // `propertiesCondition` (edit_tool.cpp:616-642).
    expect(row(menuOver(fps[0]!), 'Properties...')).toBeDefined();
    expect(row(menuOver(fps[0]!, fps[1]!), 'Properties...')).toBeUndefined();
  });

  it('names the footprint-update row singular for one, plural for many', () => {
    // pcb_actions.cpp:998-1002.
    expect(row(menuOver(fps[0]!), 'Update Footprint...')).toBeDefined();
    expect(row(menuOver(fps[0]!, fps[1]!), 'Update Footprints from Library...')).toBeDefined();
  });

  it('carries the accelerators Move Individually and Swap are defined with', () => {
    // pcb_actions.cpp:601-605 and :704-708.
    const items = menuOver(fps[0]!, fps[1]!);
    expect(row(items, 'Move Individually')?.shortcut).toBe('Ctrl+M');
    expect(row(items, 'Swap')?.shortcut).toBe('Alt+S');
  });

  it('opens Align/Distribute from two items and its distribute group from three', () => {
    // align_distribute_tool.cpp:70-71.
    expect(row(menuOver(fps[0]!), 'Align/Distribute')).toBeUndefined();
    const two = rowsOf(row(menuOver(fps[0]!, fps[1]!), 'Align/Distribute')!.submenu!);
    expect(two).toContain('Align to Bottom');
    expect(two.some((r) => r.startsWith('Distribute'))).toBe(false);
    const three = rowsOf(row(menuOver(fps[0]!, fps[1]!, fps[2]!), 'Align/Distribute')!.submenu!);
    for (const r of [
      'Distribute Horizontally by Centers',
      'Distribute Horizontally with Even Gaps',
      'Distribute Vertically by Centers',
      'Distribute Vertically with Even Gaps',
    ])
      expect(three).toContain(r);
  });
});

describe('the rows a connectable item is entitled to', () => {
  it('puts Assign Netclass right after Properties', () => {
    // edit_tool.cpp:797-801.
    const rows = rowsOf(menuOver(pad));
    expect(rows[rows.indexOf('Properties...') + 1]).toBe('Assign Netclass...');
  });

  it('gates Assign Netclass on the connected types', () => {
    // `connectedTypes` (edit_tool.cpp:128).
    expect(row(menuOver(pad), 'Assign Netclass...')).toBeDefined();
    expect(row(menuOver(track), 'Assign Netclass...')).toBeDefined();
    expect(row(menuOver(fps[0]!), 'Assign Netclass...')).toBeUndefined();
  });

  it("draws BOARD_INSPECTION_TOOL's NET_CONTEXT_MENU", () => {
    // board_inspection_tool.cpp:68-82.
    expect(rowsOf(row(menuOver(pad), 'Net Inspection Tools')!.submenu!)).toEqual([
      'Show Net in Ratsnest',
      'Hide Net in Ratsnest',
      '----',
      'Highlight Net',
      'Clear Net Highlighting',
    ]);
  });
});

describe('the two drag rows are gated the way EDIT_TOOL gates them', () => {
  // `drag45Degree` (edit_tool.cpp:776-777) is `Count( 1 ) && OnlyTypes(
  // DraggableItems )`; `dragFreeAngle` (:778-780) is that AND `!OnlyTypes(
  // footprintTypes )`.
  it('offers Drag 45 over a footprint but not Drag Free Angle', () => {
    const items = menuOver(fps[0]!);
    expect(row(items, 'Drag 45 Degree Mode')).toBeDefined();
    expect(row(items, 'Drag Free Angle')).toBeUndefined();
  });

  it('offers neither over two items', () => {
    const items = menuOver(fps[0]!, fps[1]!);
    expect(row(items, 'Drag 45 Degree Mode')).toBeUndefined();
    expect(row(items, 'Drag Free Angle')).toBeUndefined();
  });
});
