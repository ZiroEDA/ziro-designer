// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order of the PCB selection menu's `@100` band is not a design decision -
 * it is a consequence, and it has to be ported as one.
 *
 * Seven tools drop a submenu into that band from their own `Init()`, each with
 * `aOrder = 100`, none of them aware of the others. `CONDITIONAL_MENU::addEntry`
 * (conditional_menu.cpp:210-221) inserts a new entry after every entry whose
 * order is <= its own, so ties keep insertion order - and insertion order is
 * the order `PCB_EDIT_FRAME::setupTools` registers the tools
 * (pcb_edit_frame.cpp:947-979):
 *
 *   EDIT_TOOL (:953)              separator, [Shape Modification], Position
 *   PCB_EDIT_TABLE_TOOL (:954)    five groups of table-cell rows, each opened
 *                                 and closed by its own `AddSeparator( 100 )`
 *                                 (edit_table_tool_base.h:94-115)
 *   BOARD_EDITOR_CONTROL (:961)   Locking, [Zone]
 *   BOARD_INSPECTION_TOOL (:962)  [Net]
 *   ALIGN_DISTRIBUTE_TOOL (:964)  [Align/Distribute], on MoreThan( 1 )
 *   CONVERT_TOOL (:972)           Create from Selection
 *   PCB_GROUP_TOOL (:973)         Grouping
 *
 * so over a single footprint the band reads
 *
 *   ----------------
 *   Position        >
 *   ----------------          <- the table band, collapsed by separator elision
 *   Locking         >
 *   Create from Selection >
 *   Grouping        >
 *
 * [px] which is exactly what the installed pcbnew draws (2026-08-31 capture,
 * PCB editor, one footprint selected).
 *
 * Ours had grouped it by hand instead - Create from Selection, Position,
 * Grouping, Locking - which reads tidier and is wrong, and which also dropped
 * the table band's rule so the two halves ran together. Nothing failed when it
 * drifted, because nothing pinned it. This does.
 *
 * It reads the frame as TEXT for the same reason `menu_hotkey_coverage.test.ts`
 * does: `qa`'s tsconfig cannot compile `.tsx`, and the menu is built inside the
 * component rather than in a data module like `ds_context_menu.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FRAME = readFileSync(
  fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
  'utf8',
);

/** The `@100` band: from its first `menuSeparator(100)` to the `@150` one. */
const BAND = (() => {
  const from = FRAME.indexOf('      menuSeparator(100),');
  const to = FRAME.indexOf('      menuSeparator(150),', from);
  expect(from, 'the menu has an @100 band').toBeGreaterThan(-1);
  expect(to, 'the menu has a @150 band after it').toBeGreaterThan(from);
  return FRAME.slice(from, to);
})();

/**
 * The band's rows in file order. A top-level entry's label is indented ten
 * spaces; a submenu's own rows sit deeper, which is what keeps "Move
 * Exactly..." out of this.
 */
const ROWS = [
  ...BAND.matchAll(
    /^ {10}label: '([^']+)'|^ {6}menuEntry\(\{ label: '([^']+)'|^ {6}(menuSeparator\(100\)),/gm,
  ),
].map((m) => m[1] ?? m[2] ?? '----');

describe('the PCB selection menu @100 band, in KiCad registration order', () => {
  it('reads Position | Locking, Net Inspection Tools, Align/Distribute, Create from Selection, Grouping', () => {
    expect(ROWS).toEqual([
      '----', // EDIT_TOOL, edit_tool.cpp:812
      'Position', // EDIT_TOOL, edit_tool.cpp:814
      '----', // PCB_EDIT_TABLE_TOOL, edit_table_tool_base.h:94
      'Locking', // BOARD_EDITOR_CONTROL, board_editor_control.cpp:437
      'Net Inspection Tools', // BOARD_INSPECTION_TOOL, board_inspection_tool.cpp:138
      'Align/Distribute', // ALIGN_DISTRIBUTE_TOOL, align_distribute_tool.cpp:88
      'Create from Selection', // CONVERT_TOOL, convert_tool.cpp:333
      'Grouping', // PCB_GROUP_TOOL, group_tool.cpp:138
    ]);
  });

  it('keeps a rule between Position and Locking, where the table rows go', () => {
    // Separator elision (CONDITIONAL_MENU::Evaluate) collapses the table
    // tool's five separators to this one while we have no table-cell rows, so
    // the rule must be present in the data even though no row of ours is
    // between them - drop it and the band loses a rule KiCad draws.
    expect(ROWS.indexOf('----', ROWS.indexOf('Position'))).toBe(ROWS.indexOf('Locking') - 1);
  });
});

describe('the rows a multi-item selection is entitled to', () => {
  // Measured against the installed pcbnew with several items selected
  // (2026-08-31): ours was missing Pack and Move Footprints and the whole
  // Align/Distribute submenu, drew a dead Properties row KiCad does not draw
  // at all, and had renamed two rows and dropped two accelerators.

  it('offers Pack and Move Footprints, on P, from two items with a footprint', () => {
    expect(FRAME).toContain("label: 'Pack and Move Footprints', shortcut: 'P'");
    expect(FRAME).toMatch(/'Pack and Move Footprints'[\s\S]{0,200}moreThanOne && anyFootprint/);
  });

  it('hides Properties on a multi-selection that is not all tracks', () => {
    // `propertiesCondition` (edit_tool.cpp:616-642), NOT `notEmpty`: one item
    // always, more than one only when every one of them is a track.
    expect(FRAME).toMatch(
      /const propertiesCondition = selection\.size === 1 \|\| \(moreThanOne && onlyTracks\);/,
    );
    expect(FRAME).toMatch(/label: 'Properties\.\.\.'[\s\S]{0,600}\n {8}propertiesCondition,/);
  });

  it('names the two footprint-update rows the way their actions are named', () => {
    // pcb_actions.cpp:998-1002 - the plural row is a different command with a
    // different name, not "Update Footprint..." with an s.
    expect(FRAME).toContain("TODO('Update Footprint...')");
    expect(FRAME).toContain("TODO('Update Footprints from Library...')");
  });

  it('carries the accelerators Move Individually and Swap are defined with', () => {
    // pcb_actions.cpp:601-605 and :704-708. Move Individually takes no
    // ellipsis: it starts an interactive move, it does not open a dialog.
    expect(FRAME).toContain("label: 'Move Individually', shortcut: 'Ctrl+M'");
    expect(FRAME).not.toContain("'Move Individually...'");
    expect(FRAME).toContain("label: 'Swap', shortcut: 'Alt+S'");
  });

  it('opens Align/Distribute from two items and its distribute group from three', () => {
    // align_distribute_tool.cpp:70-71: canAlign is MoreThan( 1 ), canDistribute
    // is MoreThan( 2 ), and the rule above the distribute group is conditional
    // on canDistribute too - so at two items the submenu ends after Align to
    // Bottom, with no trailing rule.
    expect(FRAME).toContain(
      "menuEntry({ label: 'Align/Distribute', submenu: alignDistributeSubmenu() }, 100, moreThanOne)",
    );
    const at = FRAME.indexOf('const alignDistributeSubmenu');
    expect(at, 'the submenu is built by one function').toBeGreaterThan(-1);
    const body = FRAME.slice(at, FRAME.indexOf('\n  };', at));
    const gate = body.indexOf('selection.size > 2');
    expect(gate, 'the distribute group is gated on MoreThan( 2 )').toBeGreaterThan(-1);
    for (const row of [
      'Distribute Horizontally by Centers',
      'Distribute Horizontally with Even Gaps',
      'Distribute Vertically by Centers',
      'Distribute Vertically with Even Gaps',
    ])
      expect(body.slice(gate)).toContain(row);
    // …and the six align rows are NOT behind that gate.
    expect(body.slice(0, gate)).toContain('Align to Bottom');
  });

  it('builds those rows in ONE place, and nowhere near a second menu', () => {
    // The rows existed all along in a hand-written Edit-menu submenu that
    // upstream does not have (menubar_pcb_editor.cpp carries no align rows),
    // while the context menu that DOES have it upstream carried none - and the
    // hand-written labels had already drifted from the actions' own
    // ("...by Gaps" for `distributeHorizontallyGaps`, whose FriendlyName is
    // "Distribute Horizontally with Even Gaps", pcb_actions.cpp:2304-2307).
    // A second literal copy of any of these rows is that bug coming back.
    // Comments stripped: prose about the rule must not read as the rule, and
    // the note above `alignDistributeSubmenu` quotes the drifted label.
    const code = FRAME.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const row of ['Align to Left', 'Align to Bottom', 'Distribute Vertically by Centers'])
      expect(code.split(`'${row}'`).length - 1, `${row} is written once`).toBe(1);
    expect(code).not.toContain('Distribute Horizontally by Gaps');
  });
});

describe('the rows a connectable item is entitled to', () => {
  // The third menu shape, over a single pad (2026-08-31 capture): KiCad prints
  // two things ours printed neither of - an Assign Netclass row and the Net
  // Inspection Tools submenu - because both are gated on the item being
  // connectable, and a pad is.

  it('puts Assign Netclass between Properties and the clearance inspector', () => {
    // edit_tool.cpp:797-801, in that order.
    const at = (needle: string): number => {
      const i = FRAME.indexOf(needle);
      expect(i, `${needle} is in the menu`).toBeGreaterThan(-1);
      return i;
    };
    const props = at("label: 'Properties...'");
    const netclass = at("TODO('Assign Netclass...')");
    const clearance = at("'Clearance Resolution...' : 'Constraints Resolution...'");
    expect(netclass).toBeGreaterThan(props);
    expect(clearance).toBeGreaterThan(netclass);
  });

  it('gates it on the five connected types, not on "something is selected"', () => {
    // `connectedTypes` (edit_tool.cpp:128).
    expect(FRAME).toContain("menuEntry(TODO('Assign Netclass...'), -1, onlyConnected)");
    expect(FRAME).toContain(
      "const connectedKinds = new Set(['track', 'arc', 'via', 'pad', 'zone']);",
    );
  });

  it('counts a copper shape as net-inspectable, which Assign Netclass does not', () => {
    // `showNetMenuFunc` (board_inspection_tool.cpp:101-131) takes those five
    // AND a PCB_SHAPE that IsOnCopperLayer(); `connectedTypes` does not. Two
    // conditions, deliberately not one.
    expect(FRAME).toContain("kind === 'shape' && shapeOnCopper(id)");
    expect(FRAME).toMatch(/menuEntry\(\s*\{\s*label: 'Net Inspection Tools',/);
    expect(FRAME).toMatch(/^ {8}netInspectable,$/m);
  });

  it('wires the submenu rows, which the frame has had all along', () => {
    // Show/Hide in Ratsnest are `hiddenNets`, Highlight Net is
    // `highlightNetSelection` (the SELECTION's nets, not the cursor's), Clear
    // Net Highlighting is the existing `~` handler.
    const at = FRAME.indexOf("label: 'Net Inspection Tools'");
    const body = FRAME.slice(at, FRAME.indexOf('netInspectable,', at));
    expect(body).toContain('setHiddenNets');
    expect(body).toContain('setHighlightNets(new Set(selectedNetsRef.current))');
    expect(body).toContain('clearHighlightRef.current()');
    expect(body).toMatch(/label: 'Clear Net Highlighting',[\s\S]*?shortcut: '~'/);
  });
});

describe('the two drag rows are gated the way EDIT_TOOL gates them', () => {
  // `drag45Degree` (edit_tool.cpp:776-777) is `Count( 1 ) && OnlyTypes(
  // DraggableItems )`; `dragFreeAngle` (:778-780) is that AND `!OnlyTypes(
  // footprintTypes )`. Both were on plain `notEmpty` here, which is why ours
  // showed Drag Free Angle over a footprint - a row the installed build does
  // not draw, and one full row of the height difference.
  const gateOf = (label: string): string => {
    const at = FRAME.indexOf(`label: '${label}'`);
    expect(at, `${label} is a row`).toBeGreaterThan(-1);
    const m = /\n {8}-1,\n {8}([A-Za-z0-9]+),/.exec(FRAME.slice(at));
    expect(m, `${label} is an @ANY_ORDER entry with a condition`).not.toBeNull();
    return m![1]!;
  };

  it('does not offer either drag over anything that is merely selected', () => {
    expect(gateOf('Drag 45 Degree Mode')).not.toBe('notEmpty');
    expect(gateOf('Drag Free Angle')).not.toBe('notEmpty');
  });

  it('gates Drag Free Angle more narrowly than Drag 45 Degree Mode', () => {
    const free = gateOf('Drag Free Angle');
    const d45 = gateOf('Drag 45 Degree Mode');
    expect(free).not.toBe(d45);
    // …and narrowly by being the other one plus the footprint exclusion.
    const def = new RegExp(`const ${free} = ${d45} && footprintCount === 0;`);
    expect(FRAME).toMatch(def);
  });
});
