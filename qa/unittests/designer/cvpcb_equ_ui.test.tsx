// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints: the `.equ` half of the window — the toolbar's
 * `CVPCB_ACTIONS::autoAssociate` button, what pressing it does, and the
 * Preferences row that opens Manage Footprint Association Files.
 *
 * Counterparts: `cvpcb/toolbars_cvpcb.cpp:48-71` (the toolbar, in order),
 * `cvpcb/tools/cvpcb_actions.cpp:53-59` and `:122-133` (the two actions'
 * FriendlyNames), `cvpcb/menubar.cpp:66-75` (the Preferences menu) and
 * `cvpcb/auto_associate.cpp:170-304` (what the button runs).
 *
 * The whole toolbar is pinned in order rather than "contains a button called
 * X", because what was wrong was a MISSING button between two present ones —
 * which every containment check in the file passed straight over.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DialogAssignFootprints } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_assign_footprints.js';

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
});
afterEach(() => cleanup());

/** Three resistors: R1 assigned, R2 "2k2" and R3 "4k7" not. */
const SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0))
    (property "Footprint" "MyFp:R_0402" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 60 50 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 0 0 0)) (property "Value" "2k2" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 70 50 0) (unit 1) (uuid "r3")
    (property "Reference" "R3" (at 0 0 0)) (property "Value" "4k7" (at 0 0 0))))`;

const TABLE = `(fp_lib_table
  (version 7)
  (lib (name "MyFp")(type "KiCad")(uri "\${KIPRJMOD}/MyFp.pretty")(options "")(descr ""))
)`;

const pro = (equFiles: string[]): string =>
  JSON.stringify({ cvpcb: { equivalence_files: equFiles }, meta: { filename: 'Proj.kicad_pro' } });

const fp = (name: string): { name: string; text: string } => ({
  name: `Proj/MyFp.pretty/${name}.kicad_mod`,
  text: `(footprint "${name}" (layer "F.Cu")
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu")))`,
});

const EQU = `# values
'2k2' 'MyFp:R_0805'
'4k7' 'MyFp:R_0603'
`;

function projectFiles(
  opts: { equFiles?: string[]; equText?: string | null } = {},
): { name: string; text: string }[] {
  const files = [
    { name: 'Proj/Proj.kicad_pro', text: pro(opts.equFiles ?? ['${KIPRJMOD}/values.equ']) },
    { name: 'Proj/fp-lib-table', text: TABLE },
    fp('R_0805'),
    fp('R_0603'),
    fp('R_0402'),
  ];
  if (opts.equText !== null) files.push({ name: 'Proj/values.equ', text: opts.equText ?? EQU });
  return files;
}

function open_(opts: { equFiles?: string[]; equText?: string | null } = {}): {
  root: HTMLElement;
  applied: { edits: unknown; save: boolean }[];
} {
  const docs = new Map([['a.kicad_sch', readSchematic(parse(SHEET))]]);
  const applied: { edits: unknown; save: boolean }[] = [];
  const { container } = render(
    <DialogAssignFootprints
      docs={docs}
      projectFootprints={projectFiles(opts)}
      onApply={(edits, o) => applied.push({ edits, save: o.save })}
      onClose={() => {}}
    />,
  );
  return { root: container, applied };
}

/** Every toolbar button, in order, by the name a screen reader gets — which is
 *  `TOOL_ACTION::GetFriendlyName()` (Toolbar.tsx's aria-label). */
const toolbarNames = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.ze-toolbar .ze-tbtn')).map(
    (b) => b.getAttribute('aria-label') ?? '',
  );

const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = Array.from(root.querySelectorAll('.ze-toolbar .ze-tbtn')).find(
    (b) => b.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no toolbar button "${label}"`);
  return found as HTMLButtonElement;
};

/**
 * The rows of the "Symbol : Footprint Assignments" pane, and only that pane.
 *
 * All three panes draw `.ze-fpassign-row`, so an unscoped query returns the
 * library list first and every assertion below reads a library nickname
 * instead of a symbol - a fixture that cannot reach what it is about.
 */
const assignmentRows = (root: HTMLElement): string[] => {
  const pane = Array.from(root.querySelectorAll('.ze-fpassign-pane')).find(
    (p) =>
      p.querySelector('.ze-fpassign-caption')?.textContent === 'Symbol : Footprint Assignments',
  );
  if (!pane) throw new Error('no assignments pane');
  return Array.from(pane.querySelectorAll('.ze-fpassign-row')).map((r) => r.textContent ?? '');
};

const statusLines = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.ze-fpassign-status > div')).map((d) => d.textContent ?? '');

describe('the top toolbar is toolbars_cvpcb.cpp’s, button for button', () => {
  it('has autoAssociate between redo and deleteAll', () => {
    // config.AppendSeparator()
    //       .AppendAction( ACTIONS::undo )
    //       .AppendAction( ACTIONS::redo )
    //       .AppendAction( CVPCB_ACTIONS::autoAssociate )
    //       .AppendAction( CVPCB_ACTIONS::deleteAll );
    //
    // The whole list, in order. A `toContain` would have passed for as long as
    // the button was missing, which is exactly how it stayed missing.
    expect(toolbarNames(open_().root)).toEqual([
      'Save to Schematic',
      'Manage Footprint Libraries...',
      'View Selected Footprint',
      'Select Previous Unassigned Symbol',
      'Select Next Unassigned Symbol',
      'Undo',
      'Redo',
      'Automatically Assign Footprints',
      'Delete All Footprint Assignments',
      'Use symbol footprint filters',
      'Filter by pin count',
      'Filter by library',
    ]);
  });

  it('is never disabled: setupUIConditions gives it no condition', () => {
    // `CVPCB_MAINFRAME::setupUIConditions` (cvpcb_mainframe.cpp:284-329) sets
    // one for saveAssociations, undo and redo and for NOTHING else, so
    // autoAssociate is live even with no association file in the project —
    // which is the state a fresh KiCad is in too.
    const { root } = open_({ equFiles: [] });
    expect(button(root, 'Automatically Assign Footprints').disabled).toBe(false);
  });
});

describe('pressing it runs AutomaticFootprintMatching', () => {
  it('assigns every unassigned symbol whose value the .equ file lists', () => {
    const { root } = open_();
    expect(assignmentRows(root)[1]).toContain('2k2 : ');
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    const rows = assignmentRows(root);
    expect(rows[1]).toContain('MyFp:R_0805');
    expect(rows[2]).toContain('MyFp:R_0603');
  });

  it('leaves the symbol that already had a footprint alone (:202-203)', () => {
    const { root } = open_();
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    expect(assignmentRows(root)[0]).toContain('MyFp:R_0402');
  });

  it('is one undo step for the whole run', () => {
    const { root } = open_();
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    fireEvent.click(button(root, 'Undo'));
    const rows = assignmentRows(root);
    expect(rows[1]).not.toContain('MyFp:R_0805');
    expect(rows[2]).not.toContain('MyFp:R_0603');
  });

  it('reports the count on status line 1 when it assigns nothing', () => {
    // `SetStatusText( msg, 0 )` (auto_associate.cpp:188) with no association
    // after it to call DisplayStatus and take the line back.
    const { root } = open_({ equFiles: [] });
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    expect(statusLines(root)[0]).toBe('0 footprint/symbol equivalences found.');
  });

  it('and does NOT report it when it assigns, because DisplayStatus runs', () => {
    const { root } = open_();
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    expect(statusLines(root)[0]).not.toContain('equivalences found');
    expect(statusLines(root)[0]).toContain('matching footprints');
  });

  it('raises "Equivalence File Load Error" for a file the project has not got', () => {
    const { root } = open_({ equText: null });
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    const dlg = root.ownerDocument.querySelector('.ze-msgdlg');
    expect(dlg?.textContent).toContain('Equivalence File Load Error');
    expect(dlg?.textContent).toContain("Equivalence file 'values.equ' could not be found.");
  });

  it('raises "CvPcb Warning" for an equivalence naming a footprint no library has', () => {
    const { root } = open_({ equText: "'2k2' 'MyFp:R_9999'\n" });
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    const dlg = root.ownerDocument.querySelector('.ze-msgdlg');
    expect(dlg?.textContent).toContain('CvPcb Warning');
    expect(dlg?.textContent).toContain(
      'Component R2: footprint MyFp:R_9999 not found in any of the project footprint libraries.',
    );
  });
});
